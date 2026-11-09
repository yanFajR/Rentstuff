import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Payment } from '@prisma/client';

import { summarizeInvoice } from '../common/finance/invoice-calculations.js';
import { todayDateOnly } from '../common/helpers/date-only.js';
import { buildPagination, type Pagination } from '../common/helpers/pagination.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { ReminderSchedulerService } from '../reminders/reminder-scheduler.service.js';
import type { PaymentMethod } from './payment-method.js';

export type PaymentListFilter = 'valid' | 'void' | null;

export const paymentListInclude = {
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      rentalRecord: {
        select: {
          id: true,
          rentalNumber: true,
          customer: { select: { id: true, name: true } },
        },
      },
    },
  },
  recordedBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
} satisfies Prisma.PaymentInclude;

export const paymentDetailInclude = {
  invoice: {
    include: {
      business: true,
      rentalRecord: {
        include: { customer: true },
      },
    },
  },
  recordedBy: { select: { id: true, name: true } },
  voidedBy: { select: { id: true, name: true } },
} satisfies Prisma.PaymentInclude;

export type PaymentListRow = Prisma.PaymentGetPayload<{ include: typeof paymentListInclude }>;
export type PaymentDetail = Prisma.PaymentGetPayload<{ include: typeof paymentDetailInclude }>;

export interface PaymentListOptions {
  businessId: string;
  search: string;
  status: PaymentListFilter;
  page: number;
  perPage: number;
}

export interface RecordPaymentInput {
  amount: number;
  paymentDate: Date;
  method: PaymentMethod;
  reference?: string;
  notes?: string;
}

export class PaymentNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PaymentNotAllowedError';
  }
}

export class PaymentExceedsOutstandingError extends Error {
  constructor(readonly outstanding: number) {
    super('Nominal pembayaran melebihi sisa tagihan.');
    this.name = 'PaymentExceedsOutstandingError';
  }
}

function optionalText(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly reminderSchedulerService: ReminderSchedulerService,
  ) {}

  async list(
    options: PaymentListOptions,
  ): Promise<{ payments: PaymentListRow[]; pagination: Pagination }> {
    const where: Prisma.PaymentWhereInput = { businessId: options.businessId };

    if (options.status === 'valid') {
      where.voidedAt = null;
    } else if (options.status === 'void') {
      where.voidedAt = { not: null };
    }

    if (options.search.length > 0) {
      where.OR = [
        { reference: { contains: options.search } },
        { invoice: { invoiceNumber: { contains: options.search } } },
        { invoice: { rentalRecord: { customer: { name: { contains: options.search } } } } },
      ];
    }

    const total = await this.prisma.payment.count({ where });
    const pagination = buildPagination(options.page, total, options.perPage);
    const payments = await this.prisma.payment.findMany({
      where,
      orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
      skip: (pagination.page - 1) * pagination.perPage,
      take: pagination.perPage,
      include: paymentListInclude,
    });

    return { payments, pagination };
  }

  async getById(businessId: string, paymentId: string): Promise<PaymentDetail> {
    const payment = await this.prisma.payment.findFirst({
      where: { id: paymentId, businessId },
      include: paymentDetailInclude,
    });

    if (!payment) {
      throw new NotFoundException('Pembayaran tidak ditemukan pada bisnis ini.');
    }

    return payment;
  }

  async record(
    businessId: string,
    invoiceId: string,
    userId: string,
    input: RecordPaymentInput,
  ): Promise<Payment> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new BadRequestException('Nominal pembayaran harus bilangan bulat lebih dari nol.');
    }

    const payment = await this.prisma.$transaction(async (transaction) => {
      const invoice = await transaction.invoice.findFirst({
        where: { id: invoiceId, businessId },
        include: {
          payments: {
            where: { voidedAt: null },
            select: { amount: true, voidedAt: true },
          },
        },
      });

      if (!invoice) {
        throw new NotFoundException('Tagihan tidak ditemukan pada bisnis ini.');
      }

      if (invoice.cancelledAt) {
        throw new PaymentNotAllowedError(
          'Invoice sudah dibatalkan dan tidak dapat menerima pembayaran.',
        );
      }

      const summary = summarizeInvoice(invoice, this.today(), this.timezone());

      if (summary.outstanding <= 0) {
        throw new PaymentNotAllowedError('Tagihan sudah lunas.');
      }

      if (input.amount > summary.outstanding) {
        throw new PaymentExceedsOutstandingError(summary.outstanding);
      }

      const created = await transaction.payment.create({
        data: {
          businessId,
          invoiceId: invoice.id,
          amount: input.amount,
          paymentDate: input.paymentDate,
          method: input.method,
          reference: optionalText(input.reference),
          notes: optionalText(input.notes),
          recordedByUserId: userId,
        },
      });

      const totals = await transaction.payment.aggregate({
        where: { invoiceId: invoice.id, voidedAt: null },
        _sum: { amount: true },
      });

      if ((totals._sum.amount ?? 0) > invoice.totalAmount) {
        throw new PaymentExceedsOutstandingError(summary.outstanding);
      }

      return created;
    });

    await this.syncReminders(businessId, invoiceId);

    return payment;
  }

  async void(businessId: string, paymentId: string, userId: string, reason: string): Promise<void> {
    const trimmedReason = reason.trim();

    if (trimmedReason.length === 0) {
      throw new BadRequestException('Alasan void wajib diisi.');
    }

    const invoiceId = await this.prisma.$transaction(async (transaction) => {
      const payment = await transaction.payment.findFirst({
        where: { id: paymentId, businessId },
        select: { id: true, invoiceId: true, voidedAt: true },
      });

      if (!payment) {
        throw new NotFoundException('Pembayaran tidak ditemukan pada bisnis ini.');
      }

      if (payment.voidedAt) {
        throw new PaymentNotAllowedError('Pembayaran ini sudah di-void.');
      }

      await transaction.payment.update({
        where: { id: payment.id },
        data: {
          voidedAt: new Date(),
          voidReason: trimmedReason,
          voidedByUserId: userId,
        },
      });

      return payment.invoiceId;
    });

    await this.syncReminders(businessId, invoiceId);
  }

  async getRecent(businessId: string, take = 5): Promise<PaymentListRow[]> {
    return this.prisma.payment.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take,
      include: paymentListInclude,
    });
  }

  private timezone(): string {
    return this.configService.get<string>('app.timezone') ?? 'Asia/Jakarta';
  }

  private today(): string {
    return todayDateOnly(this.timezone());
  }

  private async syncReminders(businessId: string, invoiceId: string): Promise<void> {
    try {
      await this.reminderSchedulerService.reconcileInvoice(businessId, invoiceId);
    } catch (error) {
      this.logger.error(
        `Gagal menyinkronkan pengingat invoice ${invoiceId}: ` +
          `${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
