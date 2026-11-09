import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type Invoice } from '@prisma/client';

import {
  aggregateInvoices,
  summarizeInvoice,
  type InvoiceAggregate,
  type InvoiceSnapshot,
  type InvoiceSummary,
  type InvoiceStatus,
} from '../common/finance/invoice-calculations.js';
import { buildPagination, type Pagination } from '../common/helpers/pagination.js';
import { todayDateOnly } from '../common/helpers/date-only.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { ReminderSchedulerService } from '../reminders/reminder-scheduler.service.js';
import { formatInvoiceNumber } from './invoice-status.js';

export const INVOICE_SORTS = [
  'created_desc',
  'created_asc',
  'issue_desc',
  'issue_asc',
  'due_asc',
  'due_desc',
] as const;
export type InvoiceSort = (typeof INVOICE_SORTS)[number];

const MAX_NUMBER_ATTEMPTS = 5;

export const invoiceListInclude = {
  rentalRecord: {
    include: {
      customer: { select: { id: true, name: true, whatsappNumber: true } },
    },
  },
  payments: {
    select: { amount: true, voidedAt: true },
  },
} satisfies Prisma.InvoiceInclude;

export const invoiceDetailInclude = {
  business: true,
  rentalRecord: {
    include: { customer: true },
  },
  payments: {
    orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
    include: {
      recordedBy: { select: { id: true, name: true } },
      voidedBy: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.InvoiceInclude;

export type InvoiceListRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceListInclude }>;
export type InvoiceDetail = Prisma.InvoiceGetPayload<{ include: typeof invoiceDetailInclude }>;

export interface InvoiceRowWithSummary extends InvoiceListRow {
  summary: InvoiceSummary;
}

export interface InvoiceListOptions {
  businessId: string;
  search: string;
  status: InvoiceStatus | null;
  from: Date | null;
  to: Date | null;
  sort: InvoiceSort;
  page: number;
  perPage: number;
}

export interface CreateInvoiceInput {
  rentalRecordId: string;
  issueDate: Date;
  dueDate: Date;
  totalAmount: number;
  description?: string;
  notes?: string;
}

export interface UpdateInvoiceInput {
  issueDate: Date;
  dueDate: Date;
  totalAmount: number;
  description?: string;
  notes?: string;
}

export type InvoiceRentalOption = Prisma.RentalRecordGetPayload<{
  select: {
    id: true;
    rentalNumber: true;
    itemName: true;
    price: true;
    status: true;
    customer: { select: { id: true; name: true; whatsappNumber: true } };
  };
}>;

export class RentalNotInvoiceableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RentalNotInvoiceableError';
  }
}

export class InvoiceLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceLockedError';
  }
}

function orderByFor(sort: InvoiceSort): Prisma.InvoiceOrderByWithRelationInput {
  switch (sort) {
    case 'created_asc':
      return { createdAt: 'asc' };
    case 'issue_desc':
      return { issueDate: 'desc' };
    case 'issue_asc':
      return { issueDate: 'asc' };
    case 'due_asc':
      return { dueDate: 'asc' };
    case 'due_desc':
      return { dueDate: 'desc' };
    case 'created_desc':
    default:
      return { createdAt: 'desc' };
  }
}

function optionalText(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class InvoiceService {
  private readonly logger = new Logger(InvoiceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly reminderSchedulerService: ReminderSchedulerService,
  ) {}

  async list(
    options: InvoiceListOptions,
  ): Promise<{ invoices: InvoiceRowWithSummary[]; pagination: Pagination }> {
    const where: Prisma.InvoiceWhereInput = { businessId: options.businessId };

    if (options.search.length > 0) {
      where.OR = [
        { invoiceNumber: { contains: options.search } },
        { rentalRecord: { rentalNumber: { contains: options.search } } },
        { rentalRecord: { customer: { name: { contains: options.search } } } },
      ];
    }

    if (options.from || options.to) {
      where.issueDate = {
        ...(options.from ? { gte: options.from } : {}),
        ...(options.to ? { lte: options.to } : {}),
      };
    }

    const orderBy = orderByFor(options.sort);
    const today = this.today();
    const timezone = this.timezone();

    if (options.status) {
      const all = await this.prisma.invoice.findMany({
        where,
        orderBy,
        include: invoiceListInclude,
      });
      const filtered = all
        .map((invoice) => ({
          ...invoice,
          summary: summarizeInvoice(invoice, today, timezone),
        }))
        .filter((invoice) => invoice.summary.status === options.status);

      const pagination = buildPagination(options.page, filtered.length, options.perPage);
      const offset = (pagination.page - 1) * pagination.perPage;

      return { invoices: filtered.slice(offset, offset + pagination.perPage), pagination };
    }

    const total = await this.prisma.invoice.count({ where });
    const pagination = buildPagination(options.page, total, options.perPage);
    const invoices = await this.prisma.invoice.findMany({
      where,
      orderBy,
      skip: (pagination.page - 1) * pagination.perPage,
      take: pagination.perPage,
      include: invoiceListInclude,
    });

    return {
      invoices: invoices.map((invoice) => ({
        ...invoice,
        summary: summarizeInvoice(invoice, today, timezone),
      })),
      pagination,
    };
  }

  async getById(businessId: string, invoiceId: string): Promise<InvoiceDetail> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, businessId },
      include: invoiceDetailInclude,
    });

    if (!invoice) {
      throw new NotFoundException('Tagihan tidak ditemukan pada bisnis ini.');
    }

    return invoice;
  }

  summarize(invoice: InvoiceSnapshot): InvoiceSummary {
    return summarizeInvoice(invoice, this.today(), this.timezone());
  }

  async getRentalOptions(businessId: string): Promise<InvoiceRentalOption[]> {
    return this.prisma.rentalRecord.findMany({
      where: { businessId, status: { not: 'CANCELLED' } },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true,
        rentalNumber: true,
        itemName: true,
        price: true,
        status: true,
        customer: { select: { id: true, name: true, whatsappNumber: true } },
      },
    });
  }

  async getRentalDefault(
    businessId: string,
    rentalId: string,
  ): Promise<InvoiceRentalOption | null> {
    return this.prisma.rentalRecord.findFirst({
      where: { id: rentalId, businessId, status: { not: 'CANCELLED' } },
      select: {
        id: true,
        rentalNumber: true,
        itemName: true,
        price: true,
        status: true,
        customer: { select: { id: true, name: true, whatsappNumber: true } },
      },
    });
  }

  async create(businessId: string, input: CreateInvoiceInput): Promise<Invoice> {
    for (let attempt = 1; attempt <= MAX_NUMBER_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (transaction) => {
          const rental = await transaction.rentalRecord.findFirst({
            where: { id: input.rentalRecordId, businessId },
            select: { id: true, status: true, customerId: true },
          });

          if (!rental) {
            throw new RentalNotInvoiceableError('Penyewaan tidak ditemukan pada bisnis ini.');
          }

          if (rental.status === 'CANCELLED') {
            throw new RentalNotInvoiceableError(
              'Penyewaan yang dibatalkan tidak dapat dibuatkan tagihan.',
            );
          }

          const sequence = await transaction.invoice.count({ where: { businessId } });

          return await transaction.invoice.create({
            data: {
              businessId,
              rentalRecordId: rental.id,
              invoiceNumber: formatInvoiceNumber(sequence + 1),
              issueDate: input.issueDate,
              dueDate: input.dueDate,
              totalAmount: input.totalAmount,
              description: optionalText(input.description),
              notes: optionalText(input.notes),
            },
          });
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          if (attempt < MAX_NUMBER_ATTEMPTS) {
            continue;
          }
          break;
        }
        throw error;
      }
    }

    throw new BadRequestException('Nomor tagihan tidak dapat dibuat saat ini. Silakan coba lagi.');
  }

  async update(businessId: string, invoiceId: string, input: UpdateInvoiceInput): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const invoice = await transaction.invoice.findFirst({
        where: { id: invoiceId, businessId },
        include: {
          payments: { select: { amount: true, voidedAt: true } },
        },
      });

      if (!invoice) {
        throw new NotFoundException('Tagihan tidak ditemukan pada bisnis ini.');
      }

      if (invoice.cancelledAt) {
        throw new InvoiceLockedError('Tagihan yang dibatalkan tidak dapat diedit.');
      }

      const summary = summarizeInvoice(invoice, this.today(), this.timezone());

      if (summary.status === 'PAID') {
        throw new InvoiceLockedError('Tagihan yang sudah lunas tidak dapat diedit.');
      }

      if (invoice.payments.length > 0) {
        throw new InvoiceLockedError(
          'Tagihan yang sudah memiliki pembayaran tidak dapat diubah total tagihannya.',
        );
      }

      await transaction.invoice.update({
        where: { id: invoice.id },
        data: {
          issueDate: input.issueDate,
          dueDate: input.dueDate,
          totalAmount: input.totalAmount,
          description: optionalText(input.description),
          notes: optionalText(input.notes),
        },
      });
    });

    await this.syncReminders(businessId, invoiceId);
  }

  async cancel(businessId: string, invoiceId: string, reason: string): Promise<void> {
    const trimmedReason = reason.trim();

    if (trimmedReason.length === 0) {
      throw new BadRequestException('Alasan pembatalan wajib diisi.');
    }

    await this.prisma.$transaction(async (transaction) => {
      const invoice = await transaction.invoice.findFirst({
        where: { id: invoiceId, businessId },
        include: {
          payments: {
            where: { voidedAt: null },
            select: { id: true },
          },
        },
      });

      if (!invoice) {
        throw new NotFoundException('Tagihan tidak ditemukan pada bisnis ini.');
      }

      if (invoice.cancelledAt) {
        throw new InvoiceLockedError('Tagihan sudah dibatalkan.');
      }

      if (invoice.payments.length > 0) {
        throw new InvoiceLockedError(
          'Tagihan masih memiliki pembayaran valid. Batalkan seluruh pembayaran terlebih dahulu sebelum membatalkan tagihan.',
        );
      }

      await transaction.invoice.update({
        where: { id: invoice.id },
        data: {
          cancelledAt: new Date(),
          cancellationReason: trimmedReason,
        },
      });
    });

    await this.syncReminders(businessId, invoiceId);
  }

  async getFinancialSummary(businessId: string): Promise<InvoiceAggregate> {
    const invoices = await this.prisma.invoice.findMany({
      where: { businessId },
      select: {
        totalAmount: true,
        dueDate: true,
        cancelledAt: true,
        payments: {
          where: { voidedAt: null },
          select: { amount: true, voidedAt: true },
        },
      },
    });

    return aggregateInvoices(invoices, this.today(), this.timezone());
  }

  async getRecent(businessId: string, take = 5): Promise<InvoiceRowWithSummary[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: { businessId },
      orderBy: { createdAt: 'desc' },
      take,
      include: invoiceListInclude,
    });

    return invoices.map((invoice) => ({
      ...invoice,
      summary: summarizeInvoice(invoice, this.today(), this.timezone()),
    }));
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
