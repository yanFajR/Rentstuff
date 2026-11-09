import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { summarizeInvoice } from '../common/finance/invoice-calculations.js';
import {
  addDaysToDateOnly,
  dateOnlyInTimezone,
  parseDateOnly,
  todayDateOnly,
} from '../common/helpers/date-only.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import {
  getReminderRule,
  planReminders,
  REMINDER_SKIP_REASONS,
  REMINDER_TIMEZONE,
  reminderTargetDate,
  type ReminderJobStatus,
  type ReminderType,
} from './reminder-rules.js';

const invoiceSnapshotInclude = {
  payments: {
    where: { voidedAt: null },
    select: { amount: true, voidedAt: true },
  },
} satisfies Prisma.InvoiceInclude;

type ReminderJobWithInvoice = Prisma.ReminderJobGetPayload<{
  include: { invoice: { include: typeof invoiceSnapshotInclude } };
}>;

export interface ReminderRunOptions {
  businessId?: string;
  todayDate?: string;
}

export interface ReminderRunResult {
  todayDate: string;
  created: number;
  promoted: number;
  skipped: number;
  reactivated: number;
  errors: number;
  alreadyRunning: boolean;
}

const REACTIVATABLE_SKIP_REASONS: string[] = [
  REMINDER_SKIP_REASONS.PAID,
  REMINDER_SKIP_REASONS.CANCELLED,
];

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class ReminderSchedulerService {
  private readonly logger = new Logger(ReminderSchedulerService.name);
  private isRunning = false;

  constructor(private readonly prisma: PrismaService) {}

  async runOnce(options: ReminderRunOptions = {}): Promise<ReminderRunResult> {
    const todayDate =
      options.todayDate && parseDateOnly(options.todayDate)
        ? options.todayDate
        : todayDateOnly(REMINDER_TIMEZONE);

    const result: ReminderRunResult = {
      todayDate,
      created: 0,
      promoted: 0,
      skipped: 0,
      reactivated: 0,
      errors: 0,
      alreadyRunning: false,
    };

    if (this.isRunning) {
      result.alreadyRunning = true;
      this.logger.warn('Scheduler reminder masih berjalan; eksekusi baru dilewati.');
      return result;
    }

    this.isRunning = true;

    try {
      await this.reconcileJobs(options.businessId, todayDate, result);
      await this.generateJobs(options.businessId, todayDate, result);
    } catch (error) {
      result.errors += 1;
      this.logger.error(
        `Scheduler reminder gagal: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    } finally {
      this.isRunning = false;
    }

    this.logger.log(
      `Scheduler reminder selesai: ${result.created} dibuat, ${result.promoted} siap, ` +
        `${result.skipped} dilewati, ${result.reactivated} diaktifkan kembali, ${result.errors} error.`,
    );

    return result;
  }

  async reconcileInvoice(businessId: string, invoiceId: string): Promise<ReminderRunResult> {
    const todayDate = todayDateOnly(REMINDER_TIMEZONE);
    const result: ReminderRunResult = {
      todayDate,
      created: 0,
      promoted: 0,
      skipped: 0,
      reactivated: 0,
      errors: 0,
      alreadyRunning: false,
    };

    const jobs = await this.prisma.reminderJob.findMany({
      where: {
        businessId,
        invoiceId,
        OR: [
          { status: { in: ['PENDING', 'READY'] } },
          {
            status: 'SKIPPED',
            skipReason: { in: REACTIVATABLE_SKIP_REASONS },
          },
        ],
      },
      include: { invoice: { include: invoiceSnapshotInclude } },
    });

    for (const job of jobs) {
      try {
        await this.reconcileJob(job, todayDate, result);
      } catch (error) {
        result.errors += 1;
        this.logger.error(
          `Gagal merekonsiliasi reminder ${job.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return result;
  }

  async recordActivity(
    businessId: string,
    reminderId: string,
    activityType: string,
    userId: string | null,
    notes: string | null = null,
  ): Promise<void> {
    await this.prisma.reminderActivity.create({
      data: { businessId, reminderId, activityType, userId, notes },
    });
  }

  private async reconcileJobs(
    businessId: string | undefined,
    todayDate: string,
    result: ReminderRunResult,
  ): Promise<void> {
    const today = parseDateOnly(todayDate);
    if (!today) {
      return;
    }

    const jobs = await this.prisma.reminderJob.findMany({
      where: {
        ...(businessId ? { businessId } : {}),
        OR: [
          { status: { in: ['PENDING', 'READY'] } },
          {
            status: 'SKIPPED',
            skipReason: { in: REACTIVATABLE_SKIP_REASONS },
            scheduledDate: { gte: today },
          },
        ],
      },
      include: { invoice: { include: invoiceSnapshotInclude } },
    });

    const skipByReason = new Map<string, ReminderJobWithInvoice[]>();
    const promoteJobs: ReminderJobWithInvoice[] = [];
    const reactivateByStatus = new Map<ReminderJobStatus, ReminderJobWithInvoice[]>();

    for (const job of jobs) {
      const plan = this.planReconciliation(job, todayDate);
      if (!plan) {
        continue;
      }

      if (plan.kind === 'skip') {
        const group = skipByReason.get(plan.reason) ?? [];
        group.push(job);
        skipByReason.set(plan.reason, group);
      } else if (plan.kind === 'promote') {
        promoteJobs.push(job);
      } else {
        const group = reactivateByStatus.get(plan.nextStatus) ?? [];
        group.push(job);
        reactivateByStatus.set(plan.nextStatus, group);
      }
    }

    await this.skipJobsBatch(skipByReason, result);
    await this.promoteJobsBatch(promoteJobs, result);
    await this.reactivateJobsBatch(reactivateByStatus, result);
  }

  private planReconciliation(
    job: ReminderJobWithInvoice,
    todayDate: string,
  ):
    | { kind: 'skip'; reason: string }
    | { kind: 'promote' }
    | { kind: 'reactivate'; nextStatus: ReminderJobStatus }
    | null {
    const rule = getReminderRule(job.reminderType);
    if (!rule) {
      return null;
    }

    const scheduledDate = dateOnlyInTimezone(job.scheduledDate, REMINDER_TIMEZONE);
    const dueDateOnly = dateOnlyInTimezone(job.invoice.dueDate, REMINDER_TIMEZONE);
    const expectedDate = reminderTargetDate(dueDateOnly, rule.type);
    const summary = summarizeInvoice(job.invoice, todayDate, REMINDER_TIMEZONE);

    const inactiveReason = job.invoice.cancelledAt
      ? REMINDER_SKIP_REASONS.CANCELLED
      : summary.outstanding <= 0
        ? REMINDER_SKIP_REASONS.PAID
        : null;

    if (job.status === 'SKIPPED') {
      if (inactiveReason === null && expectedDate === scheduledDate && scheduledDate >= todayDate) {
        return {
          kind: 'reactivate',
          nextStatus: scheduledDate <= todayDate ? 'READY' : 'PENDING',
        };
      }
      return null;
    }

    if (inactiveReason) {
      return { kind: 'skip', reason: inactiveReason };
    }

    if (expectedDate !== scheduledDate) {
      return { kind: 'skip', reason: REMINDER_SKIP_REASONS.DUE_DATE_CHANGED };
    }

    if (job.status === 'PENDING' && scheduledDate <= todayDate) {
      return { kind: 'promote' };
    }

    return null;
  }

  private async reconcileJob(
    job: ReminderJobWithInvoice,
    todayDate: string,
    result: ReminderRunResult,
  ): Promise<void> {
    const plan = this.planReconciliation(job, todayDate);
    if (!plan) {
      return;
    }

    if (plan.kind === 'skip') {
      await this.skipJob(job, plan.reason, result);
    } else if (plan.kind === 'promote') {
      await this.promoteJob(job, result);
    } else {
      await this.reactivateJob(job, plan.nextStatus, result);
    }
  }

  private async skipJobsBatch(
    byReason: Map<string, ReminderJobWithInvoice[]>,
    result: ReminderRunResult,
  ): Promise<void> {
    const now = new Date();

    for (const [reason, jobs] of byReason) {
      for (let index = 0; index < jobs.length; index += 200) {
        const chunk = jobs.slice(index, index + 200);
        try {
          const updatedCount = await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.reminderJob.updateMany({
              where: {
                id: { in: chunk.map((job) => job.id) },
                status: { in: ['PENDING', 'READY'] },
              },
              data: { status: 'SKIPPED', skippedAt: now, skipReason: reason },
            });

            if (updated.count > 0) {
              const updatedJobs =
                updated.count === chunk.length
                  ? chunk
                  : await transaction.reminderJob.findMany({
                      where: {
                        id: { in: chunk.map((job) => job.id) },
                        status: 'SKIPPED',
                        skippedAt: now,
                      },
                      select: { id: true, businessId: true },
                    });
              if (updatedJobs.length > 0) {
                await transaction.reminderActivity.createMany({
                  data: updatedJobs.map((job) => ({
                    businessId: job.businessId,
                    reminderId: job.id,
                    activityType: 'SKIPPED',
                    notes: reason,
                  })),
                });
              }
            }
            return updated.count;
          });
          result.skipped += updatedCount;
        } catch (error) {
          result.errors += 1;
          this.logger.error(
            `Gagal melewati batch reminder: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  private async promoteJobsBatch(
    jobs: ReminderJobWithInvoice[],
    result: ReminderRunResult,
  ): Promise<void> {
    for (let index = 0; index < jobs.length; index += 200) {
      const chunk = jobs.slice(index, index + 200);
      try {
        const updated = await this.prisma.reminderJob.updateMany({
          where: { id: { in: chunk.map((job) => job.id) }, status: 'PENDING' },
          data: { status: 'READY', processedAt: new Date() },
        });
        result.promoted += updated.count;
      } catch (error) {
        result.errors += 1;
        this.logger.error(
          `Gagal mempromosikan batch reminder: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async reactivateJobsBatch(
    byStatus: Map<ReminderJobStatus, ReminderJobWithInvoice[]>,
    result: ReminderRunResult,
  ): Promise<void> {
    const now = new Date();

    for (const [nextStatus, jobs] of byStatus) {
      for (let index = 0; index < jobs.length; index += 200) {
        const chunk = jobs.slice(index, index + 200);
        try {
          const updatedCount = await this.prisma.$transaction(async (transaction) => {
            const updated = await transaction.reminderJob.updateMany({
              where: {
                id: { in: chunk.map((job) => job.id) },
                status: 'SKIPPED',
              },
              data: {
                status: nextStatus,
                skippedAt: null,
                skipReason: null,
                processedAt: nextStatus === 'READY' ? now : null,
              },
            });

            if (updated.count > 0) {
              const updatedJobs =
                updated.count === chunk.length
                  ? chunk
                  : await transaction.reminderJob.findMany({
                      where: {
                        id: { in: chunk.map((job) => job.id) },
                        status: nextStatus,
                        skippedAt: null,
                      },
                      select: { id: true, businessId: true },
                    });
              if (updatedJobs.length > 0) {
                await transaction.reminderActivity.createMany({
                  data: updatedJobs.map((job) => ({
                    businessId: job.businessId,
                    reminderId: job.id,
                    activityType: 'REACTIVATED',
                    notes: 'Diaktifkan kembali karena invoice kembali memiliki sisa tagihan.',
                  })),
                });
              }
            }
            return updated.count;
          });
          result.reactivated += updatedCount;
        } catch (error) {
          result.errors += 1;
          this.logger.error(
            `Gagal mengaktifkan kembali batch reminder: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  private async skipJob(
    job: ReminderJobWithInvoice,
    reason: string,
    result: ReminderRunResult,
  ): Promise<void> {
    const now = new Date();

    const updated = await this.prisma.$transaction(async (transaction) => {
      const update = await transaction.reminderJob.updateMany({
        where: { id: job.id, status: { in: ['PENDING', 'READY'] } },
        data: { status: 'SKIPPED', skippedAt: now, skipReason: reason },
      });

      if (update.count > 0) {
        await transaction.reminderActivity.create({
          data: {
            businessId: job.businessId,
            reminderId: job.id,
            activityType: 'SKIPPED',
            notes: reason,
          },
        });
      }

      return update.count;
    });

    if (updated > 0) {
      result.skipped += 1;
    }
  }

  private async promoteJob(job: ReminderJobWithInvoice, result: ReminderRunResult): Promise<void> {
    const update = await this.prisma.reminderJob.updateMany({
      where: { id: job.id, status: 'PENDING' },
      data: { status: 'READY', processedAt: new Date() },
    });

    if (update.count > 0) {
      result.promoted += 1;
    }
  }

  private async reactivateJob(
    job: ReminderJobWithInvoice,
    nextStatus: ReminderJobStatus,
    result: ReminderRunResult,
  ): Promise<void> {
    const now = new Date();

    const update = await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.reminderJob.updateMany({
        where: { id: job.id, status: 'SKIPPED' },
        data: {
          status: nextStatus,
          skippedAt: null,
          skipReason: null,
          processedAt: nextStatus === 'READY' ? now : null,
        },
      });

      if (updated.count > 0) {
        await transaction.reminderActivity.create({
          data: {
            businessId: job.businessId,
            reminderId: job.id,
            activityType: 'REACTIVATED',
            notes: 'Diaktifkan kembali karena invoice kembali memiliki sisa tagihan.',
          },
        });
      }

      return updated.count;
    });

    if (update > 0) {
      result.reactivated += 1;
    }
  }

  private async generateJobs(
    businessId: string | undefined,
    todayDate: string,
    result: ReminderRunResult,
  ): Promise<void> {
    const from = parseDateOnly(addDaysToDateOnly(todayDate, -1));
    const to = parseDateOnly(addDaysToDateOnly(todayDate, 3));

    if (!from || !to) {
      return;
    }

    const invoices = await this.prisma.invoice.findMany({
      where: {
        ...(businessId ? { businessId } : {}),
        cancelledAt: null,
        dueDate: { gte: from, lte: to },
      },
      include: invoiceSnapshotInclude,
    });

    for (const invoice of invoices) {
      try {
        const summary = summarizeInvoice(invoice, todayDate, REMINDER_TIMEZONE);
        if (summary.outstanding <= 0) {
          continue;
        }

        const dueDateOnly = dateOnlyInTimezone(invoice.dueDate, REMINDER_TIMEZONE);
        const plans = planReminders(dueDateOnly, todayDate);

        for (const plan of plans) {
          try {
            const created = await this.createJob(
              invoice.businessId,
              invoice.id,
              plan.type,
              plan.scheduledDate,
              plan.status,
            );
            if (created) {
              result.created += 1;
            }
          } catch (error) {
            result.errors += 1;
            this.logger.error(
              `Gagal membuat reminder ${plan.type} untuk invoice ${invoice.id}: ` +
                `${error instanceof Error ? error.message : String(error)}`,
            );
          }
        }
      } catch (error) {
        result.errors += 1;
        this.logger.error(
          `Gagal memproses invoice ${invoice.id}: ` +
            `${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }

  private async createJob(
    businessId: string,
    invoiceId: string,
    reminderType: ReminderType,
    scheduledDateOnly: string,
    status: 'PENDING' | 'READY',
  ): Promise<boolean> {
    const scheduledDate = parseDateOnly(scheduledDateOnly);
    if (!scheduledDate) {
      return false;
    }

    const rule = getReminderRule(reminderType);

    try {
      await this.prisma.$transaction(async (transaction) => {
        const job = await transaction.reminderJob.create({
          data: {
            businessId,
            invoiceId,
            reminderType,
            scheduledDate,
            status,
            processedAt: status === 'READY' ? new Date() : null,
          },
        });

        await transaction.reminderActivity.create({
          data: {
            businessId,
            reminderId: job.id,
            activityType: 'CREATED',
            notes: `Dibuat otomatis oleh scheduler untuk aturan ${rule?.label ?? reminderType}.`,
          },
        });
      });
      return true;
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        return false;
      }
      throw error;
    }
  }
}
