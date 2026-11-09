import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { summarizeInvoice, type InvoiceSummary } from '../common/finance/invoice-calculations.js';
import { dateOnlyInTimezone, todayDateOnly } from '../common/helpers/date-only.js';
import { normalizeWhatsAppNumber } from '../common/helpers/whatsapp.js';
import { buildPagination, type Pagination } from '../common/helpers/pagination.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { buildReminderMessage, buildWhatsAppUrl } from './reminder-message.js';
import { ReminderSchedulerService } from './reminder-scheduler.service.js';
import { REMINDER_TIMEZONE, type ReminderJobStatus, type ReminderType } from './reminder-rules.js';
import {
  deriveContactStatus,
  deriveTimingCategory,
  type ReminderContactStatus,
  type ReminderTimingCategory,
} from './reminder-status.js';

export const REMINDER_SORTS = [
  'scheduled_desc',
  'scheduled_asc',
  'created_desc',
  'due_asc',
] as const;
export type ReminderSort = (typeof REMINDER_SORTS)[number];

const listInclude = {
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      totalAmount: true,
      dueDate: true,
      cancelledAt: true,
      rentalRecord: {
        select: {
          id: true,
          rentalNumber: true,
          customer: {
            select: { id: true, name: true, whatsappNumber: true },
          },
        },
      },
      payments: {
        where: { voidedAt: null },
        select: { amount: true, voidedAt: true },
      },
    },
  },
  activities: {
    orderBy: { createdAt: 'asc' },
    select: { activityType: true },
  },
} satisfies Prisma.ReminderJobInclude;

const detailInclude = {
  invoice: {
    include: {
      business: true,
      rentalRecord: { include: { customer: true } },
      payments: {
        where: { voidedAt: null },
        select: { amount: true, voidedAt: true },
      },
    },
  },
  activities: {
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true } } },
  },
} satisfies Prisma.ReminderJobInclude;

export type ReminderListRow = Prisma.ReminderJobGetPayload<{ include: typeof listInclude }>;
export type ReminderDetail = Prisma.ReminderJobGetPayload<{ include: typeof detailInclude }>;

export interface ReminderRowWithDerived extends ReminderListRow {
  summary: InvoiceSummary;
  scheduledDateOnly: string;
  dueDateOnly: string;
  contactStatus: ReminderContactStatus;
  timingCategory: ReminderTimingCategory;
}

export interface ReminderListOptions {
  businessId: string;
  search: string;
  type: ReminderType | null;
  status: ReminderJobStatus | null;
  from: Date | null;
  to: Date | null;
  sort: ReminderSort;
  page: number;
  perPage: number;
}

export interface ReminderSummaryCounts {
  upcoming: number;
  dueToday: number;
  overdue: number;
  notContacted: number;
  sent: number;
  totalActive: number;
}

export class ReminderActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ReminderActionError';
  }
}

function orderByFor(sort: ReminderSort): Prisma.ReminderJobOrderByWithRelationInput[] {
  switch (sort) {
    case 'scheduled_asc':
      return [{ scheduledDate: 'asc' }, { createdAt: 'asc' }];
    case 'created_desc':
      return [{ createdAt: 'desc' }];
    case 'due_asc':
      return [{ invoice: { dueDate: 'asc' } }, { scheduledDate: 'asc' }];
    case 'scheduled_desc':
    default:
      return [{ scheduledDate: 'desc' }, { createdAt: 'desc' }];
  }
}

@Injectable()
export class ReminderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulerService: ReminderSchedulerService,
  ) {}

  async list(
    options: ReminderListOptions,
  ): Promise<{ reminders: ReminderRowWithDerived[]; pagination: Pagination }> {
    const where: Prisma.ReminderJobWhereInput = { businessId: options.businessId };

    if (options.type) {
      where.reminderType = options.type;
    }

    if (options.status) {
      where.status = options.status;
    }

    if (options.from || options.to) {
      where.scheduledDate = {
        ...(options.from ? { gte: options.from } : {}),
        ...(options.to ? { lte: options.to } : {}),
      };
    }

    if (options.search.length > 0) {
      where.invoice = {
        OR: [
          { invoiceNumber: { contains: options.search } },
          { rentalRecord: { customer: { name: { contains: options.search } } } },
        ],
      };
    }

    const total = await this.prisma.reminderJob.count({ where });
    const pagination = buildPagination(options.page, total, options.perPage);
    const reminders = await this.prisma.reminderJob.findMany({
      where,
      orderBy: orderByFor(options.sort),
      skip: (pagination.page - 1) * pagination.perPage,
      take: pagination.perPage,
      include: listInclude,
    });

    return {
      reminders: reminders.map((reminder) => this.withDerived(reminder)),
      pagination,
    };
  }

  async getById(businessId: string, reminderId: string): Promise<ReminderDetail> {
    const reminder = await this.prisma.reminderJob.findFirst({
      where: { id: reminderId, businessId },
      include: detailInclude,
    });

    if (!reminder) {
      throw new NotFoundException('Pengingat tidak ditemukan pada bisnis ini.');
    }

    return reminder;
  }

  summarize(reminder: ReminderDetail): InvoiceSummary {
    return summarizeInvoice(reminder.invoice, this.today(), REMINDER_TIMEZONE);
  }

  contactStatus(reminder: ReminderDetail): ReminderContactStatus {
    return deriveContactStatus(reminder.activities);
  }

  timingCategory(dueDate: Date): ReminderTimingCategory {
    return deriveTimingCategory(dateOnlyInTimezone(dueDate, REMINDER_TIMEZONE), this.today());
  }

  async getSummary(businessId: string): Promise<ReminderSummaryCounts> {
    const today = this.today();
    const reminders = await this.prisma.reminderJob.findMany({
      where: { businessId },
      select: {
        status: true,
        scheduledDate: true,
        activities: { select: { activityType: true } },
        invoice: {
          select: {
            totalAmount: true,
            dueDate: true,
            cancelledAt: true,
            payments: {
              where: { voidedAt: null },
              select: { amount: true, voidedAt: true },
            },
          },
        },
      },
    });

    const summary: ReminderSummaryCounts = {
      upcoming: 0,
      dueToday: 0,
      overdue: 0,
      notContacted: 0,
      sent: 0,
      totalActive: 0,
    };

    for (const reminder of reminders) {
      if (reminder.status === 'SKIPPED') {
        continue;
      }

      const invoiceSummary = summarizeInvoice(reminder.invoice, today, REMINDER_TIMEZONE);
      if (invoiceSummary.outstanding <= 0 || reminder.invoice.cancelledAt) {
        continue;
      }

      summary.totalActive += 1;
      const dueDateOnly = dateOnlyInTimezone(reminder.invoice.dueDate, REMINDER_TIMEZONE);
      const contactStatus = deriveContactStatus(reminder.activities);

      if (dueDateOnly > today) {
        summary.upcoming += 1;
      } else if (dueDateOnly === today) {
        summary.dueToday += 1;
      } else {
        summary.overdue += 1;
      }

      if (reminder.status === 'READY' && contactStatus === 'PENDING') {
        summary.notContacted += 1;
      } else if (contactStatus === 'SENT') {
        summary.sent += 1;
      }
    }

    return summary;
  }

  async getRecent(businessId: string, take = 5): Promise<ReminderRowWithDerived[]> {
    const reminders = await this.prisma.reminderJob.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take,
      include: listInclude,
    });

    return reminders.map((reminder) => this.withDerived(reminder));
  }

  async openWhatsApp(businessId: string, reminderId: string, userId: string): Promise<string> {
    let reminder = await this.getById(businessId, reminderId);
    await this.schedulerService.reconcileInvoice(businessId, reminder.invoiceId);
    reminder = await this.getById(businessId, reminderId);

    if (reminder.status === 'SKIPPED') {
      throw new ReminderActionError(
        reminder.skipReason
          ? `Pengingat ini sudah dilewati: ${reminder.skipReason}`
          : 'Pengingat ini sudah dilewati.',
      );
    }

    if (reminder.status !== 'READY') {
      throw new ReminderActionError(
        'Pengingat ini belum memasuki jadwal pengiriman. Tunggu sampai tanggalnya tiba.',
      );
    }

    const summary = this.summarize(reminder);

    if (reminder.invoice.cancelledAt || summary.outstanding <= 0) {
      throw new ReminderActionError(
        reminder.invoice.cancelledAt
          ? 'Tagihan sudah dibatalkan sehingga pengingat tidak dapat dikirim.'
          : 'Tagihan sudah lunas sehingga pengingat tidak dapat dikirim.',
      );
    }

    const customer = reminder.invoice.rentalRecord.customer;
    const normalizedNumber = normalizeWhatsAppNumber(customer.whatsappNumber);
    if (!normalizedNumber) {
      throw new ReminderActionError(
        'Nomor WhatsApp pelanggan tidak valid. Perbarui nomor pelanggan terlebih dahulu.',
      );
    }

    const message = buildReminderMessage({
      customerName: customer.name,
      invoiceNumber: reminder.invoice.invoiceNumber,
      businessName: reminder.invoice.business.name,
      outstanding: summary.outstanding,
      dueDate: reminder.invoice.dueDate,
      timezone: REMINDER_TIMEZONE,
    });

    const url = buildWhatsAppUrl(normalizedNumber, message);
    if (!url) {
      throw new ReminderActionError('URL WhatsApp tidak dapat dibuat dari nomor pelanggan.');
    }

    await this.schedulerService.recordActivity(
      businessId,
      reminder.id,
      'WHATSAPP_OPENED',
      userId,
      'Link WhatsApp dibuka dari halaman detail pengingat.',
    );

    return url;
  }

  async markSent(
    businessId: string,
    reminderId: string,
    userId: string,
    notes: string | null,
  ): Promise<void> {
    let reminder = await this.getById(businessId, reminderId);
    await this.schedulerService.reconcileInvoice(businessId, reminder.invoiceId);
    reminder = await this.getById(businessId, reminderId);

    if (reminder.status === 'SKIPPED') {
      throw new ReminderActionError(
        reminder.skipReason
          ? `Pengingat ini sudah dilewati: ${reminder.skipReason}`
          : 'Pengingat ini sudah dilewati.',
      );
    }

    if (reminder.status !== 'READY') {
      throw new ReminderActionError(
        'Pengingat ini belum memasuki jadwal. Status terkirim baru dapat ditandai saat jadwal tiba.',
      );
    }

    const summary = this.summarize(reminder);
    if (reminder.invoice.cancelledAt || summary.outstanding <= 0) {
      throw new ReminderActionError(
        'Tagihan sudah tidak memiliki sisa tagihan sehingga pengingat tidak dapat ditandai terkirim.',
      );
    }

    if (deriveContactStatus(reminder.activities) === 'SENT') {
      throw new ReminderActionError('Pengingat ini sudah ditandai sebagai terkirim.');
    }

    const trimmedNotes = notes?.trim();

    await this.schedulerService.recordActivity(
      businessId,
      reminder.id,
      'MARKED_SENT',
      userId,
      trimmedNotes && trimmedNotes.length > 0 ? trimmedNotes : null,
    );
  }

  private withDerived(reminder: ReminderListRow): ReminderRowWithDerived {
    const today = this.today();
    const dueDateOnly = dateOnlyInTimezone(reminder.invoice.dueDate, REMINDER_TIMEZONE);

    return {
      ...reminder,
      summary: summarizeInvoice(reminder.invoice, today, REMINDER_TIMEZONE),
      scheduledDateOnly: dateOnlyInTimezone(reminder.scheduledDate, REMINDER_TIMEZONE),
      dueDateOnly,
      contactStatus: deriveContactStatus(reminder.activities),
      timingCategory: deriveTimingCategory(dueDateOnly, today),
    };
  }

  private today(): string {
    return todayDateOnly(REMINDER_TIMEZONE);
  }
}
