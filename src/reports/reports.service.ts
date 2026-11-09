import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';

import { summarizeInvoice } from '../common/finance/invoice-calculations.js';
import { dateOnlyInTimezone, parseDateOnly, todayDateOnly } from '../common/helpers/date-only.js';
import { buildPagination, type Pagination } from '../common/helpers/pagination.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_METHODS,
  type PaymentMethod,
} from '../payments/payment-method.js';
import { RENTAL_STATUS_LABELS, type RentalStatus } from '../rentals/rental-status.js';
import {
  getReminderRule,
  type ReminderJobStatus,
  type ReminderType,
} from '../reminders/reminder-rules.js';
import {
  deriveContactStatus,
  REMINDER_CONTACT_STATUS_LABELS,
  REMINDER_JOB_STATUS_LABELS,
} from '../reminders/reminder-status.js';
import {
  RECEIVABLE_GROUPS,
  receivableGroupFor,
  statusLabelForCsv,
  summarizeInvoiceGroup,
  summarizeRentalInvoices,
  type InvoiceGroupSummary,
} from './report-calculations.js';
import { csvDate, csvDateTime, type CsvRow } from './report-csv.js';
import { monthEndDateOnly, shiftMonthDateOnly } from './report-period.js';
import type {
  InvoiceReportOptions,
  InvoiceReportRow,
  MonthlyTrendPoint,
  PaymentMethodSummary,
  PaymentReportData,
  PaymentReportOptions,
  PaymentReportRow,
  PaymentReportSummary,
  ReceivableGroupSummary,
  ReceivableReportData,
  ReceivableReportOptions,
  ReceivableReportRow,
  ReminderReportData,
  ReminderReportOptions,
  ReminderReportRow,
  ReminderReportSummary,
  RentalReportData,
  RentalReportOptions,
  RentalReportRow,
  SummaryReport,
} from './report-types.js';

const EXPORT_BATCH_SIZE = 200;

export const REPORT_CSV_HEADERS = {
  rentals: [
    'Nomor Rental',
    'Nama Pelanggan',
    'Barang/Jasa',
    'Tanggal Mulai',
    'Tanggal Selesai',
    'Harga Rental',
    'Status Rental',
    'Jumlah Invoice',
    'Total Tagihan',
    'Total Pembayaran',
    'Outstanding',
  ],
  invoices: [
    'Nomor Invoice',
    'Nama Pelanggan',
    'Nomor Rental',
    'Tanggal Penerbitan',
    'Jatuh Tempo',
    'Total Invoice',
    'Total Pembayaran Valid',
    'Outstanding',
    'Status Invoice',
  ],
  payments: [
    'Tanggal Pembayaran',
    'Nomor Invoice',
    'Nama Pelanggan',
    'Nominal Pembayaran',
    'Metode Pembayaran',
    'Referensi',
    'Dicatat Oleh',
    'Status Pembayaran',
  ],
  receivables: [
    'Nomor Invoice',
    'Nama Pelanggan',
    'Nomor WhatsApp',
    'Tanggal Penerbitan',
    'Jatuh Tempo',
    'Total Invoice',
    'Total Pembayaran Valid',
    'Outstanding',
    'Hari Terlambat',
    'Status Invoice',
  ],
  reminders: [
    'Tanggal Reminder',
    'Nomor Invoice',
    'Nama Pelanggan',
    'Jenis Reminder',
    'Status Job',
    'Aktivitas WhatsApp',
    'Waktu WhatsApp Dibuka',
    'Waktu Ditandai Terkirim',
    'User Aktivitas',
  ],
} as const;

const rentalReportInclude = {
  customer: { select: { id: true, name: true } },
  invoices: {
    select: {
      totalAmount: true,
      cancelledAt: true,
      payments: {
        where: { voidedAt: null },
        select: { amount: true, voidedAt: true },
      },
    },
  },
} satisfies Prisma.RentalRecordInclude;

type RentalReportRecord = Prisma.RentalRecordGetPayload<{
  include: typeof rentalReportInclude;
}>;

const invoiceReportInclude = {
  rentalRecord: {
    select: {
      rentalNumber: true,
      customer: { select: { name: true } },
    },
  },
  payments: {
    where: { voidedAt: null },
    select: { amount: true, voidedAt: true },
  },
} satisfies Prisma.InvoiceInclude;

type InvoiceReportRecord = Prisma.InvoiceGetPayload<{
  include: typeof invoiceReportInclude;
}>;

const paymentReportInclude = {
  invoice: {
    select: {
      id: true,
      invoiceNumber: true,
      rentalRecord: {
        select: { customer: { select: { name: true } } },
      },
    },
  },
  recordedBy: { select: { name: true } },
} satisfies Prisma.PaymentInclude;

type PaymentReportRecord = Prisma.PaymentGetPayload<{
  include: typeof paymentReportInclude;
}>;

const receivableSelect = {
  id: true,
  invoiceNumber: true,
  issueDate: true,
  dueDate: true,
  totalAmount: true,
  cancelledAt: true,
  rentalRecord: {
    select: {
      customer: { select: { id: true, name: true, whatsappNumber: true } },
    },
  },
} satisfies Prisma.InvoiceSelect;

type ReceivableRecord = Prisma.InvoiceGetPayload<{
  select: typeof receivableSelect;
}>;

const reminderReportInclude = {
  invoice: {
    select: {
      invoiceNumber: true,
      rentalRecord: {
        select: { customer: { select: { name: true } } },
      },
    },
  },
  activities: {
    orderBy: { createdAt: 'asc' },
    select: {
      activityType: true,
      createdAt: true,
      user: { select: { name: true } },
    },
  },
} satisfies Prisma.ReminderJobInclude;

type ReminderReportRecord = Prisma.ReminderJobGetPayload<{
  include: typeof reminderReportInclude;
}>;

const rentalOrderBy: Record<string, Prisma.RentalRecordOrderByWithRelationInput> = {
  start_desc: { startDate: 'desc' },
  start_asc: { startDate: 'asc' },
  created_desc: { createdAt: 'desc' },
};

const invoiceOrderBy: Record<string, Prisma.InvoiceOrderByWithRelationInput> = {
  issue_desc: { issueDate: 'desc' },
  issue_asc: { issueDate: 'asc' },
  due_asc: { dueDate: 'asc' },
  due_desc: { dueDate: 'desc' },
  total_desc: { totalAmount: 'desc' },
};

const paymentOrderBy: Record<string, Prisma.PaymentOrderByWithRelationInput[]> = {
  date_desc: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
  date_asc: [{ paymentDate: 'asc' }, { createdAt: 'asc' }],
  amount_desc: [{ amount: 'desc' }, { paymentDate: 'desc' }],
};

function emptyPaymentSummary(): PaymentReportSummary {
  return {
    totalValid: 0,
    validCount: 0,
    totalVoid: 0,
    voidCount: 0,
    transactionCount: 0,
    methods: Object.fromEntries(
      PAYMENT_METHODS.map((method) => [method, { total: 0, count: 0 }]),
    ) as Record<PaymentMethod, PaymentMethodSummary>,
  };
}

@Injectable()
export class ReportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getSummary(
    businessId: string,
    period: { fromDate: Date; toDate: Date; previousFromDate: Date; previousToDate: Date },
  ): Promise<SummaryReport> {
    const today = this.today();
    const timezone = this.timezone();

    const [invoices, currentPayments, previousPayments, invoiceTotals, activePaymentTotals, trend] =
      await Promise.all([
        this.prisma.invoice.findMany({
          where: {
            businessId,
            issueDate: { gte: period.fromDate, lte: period.toDate },
          },
          select: {
            id: true,
            totalAmount: true,
            dueDate: true,
            cancelledAt: true,
            payments: {
              where: { voidedAt: null },
              select: { amount: true, voidedAt: true },
            },
          },
        }),
        this.prisma.payment.aggregate({
          where: {
            businessId,
            voidedAt: null,
            paymentDate: { gte: period.fromDate, lte: period.toDate },
          },
          _sum: { amount: true },
          _count: { _all: true },
        }),
        this.prisma.payment.aggregate({
          where: {
            businessId,
            voidedAt: null,
            paymentDate: {
              gte: period.previousFromDate,
              lte: period.previousToDate,
            },
          },
          _sum: { amount: true },
        }),
        this.prisma.invoice.aggregate({
          where: { businessId, cancelledAt: null },
          _sum: { totalAmount: true },
        }),
        this.prisma.payment.aggregate({
          where: {
            businessId,
            voidedAt: null,
            invoice: { cancelledAt: null },
          },
          _sum: { amount: true },
        }),
        this.getMonthlyTrend(businessId),
      ]);

    const group = summarizeInvoiceGroup(invoices, today, timezone);
    const paymentsTotal = currentPayments._sum.amount ?? 0;
    const previousPaymentsTotal = previousPayments._sum.amount ?? 0;
    const outstanding = Math.max(
      0,
      (invoiceTotals._sum.totalAmount ?? 0) - (activePaymentTotals._sum.amount ?? 0),
    );

    return {
      invoiceTotal: group.totalIssued,
      invoiceCount: group.invoiceCount,
      activeInvoiceCount: group.activeInvoiceCount,
      cancelledCount: group.cancelledCount,
      paidCount: group.paidCount,
      unpaidCount: group.unpaidCount,
      partialCount: group.partialCount,
      overdueCount: group.overdueCount,
      paymentsTotal,
      paymentsCount: currentPayments._count._all,
      outstanding,
      previousPaymentsTotal,
      paymentChangePercent:
        previousPaymentsTotal > 0
          ? Math.round(((paymentsTotal - previousPaymentsTotal) / previousPaymentsTotal) * 1000) /
            10
          : null,
      trend,
    };
  }

  async getMonthlyTrend(businessId: string, months = 6): Promise<MonthlyTrendPoint[]> {
    const today = this.today();
    const formatter = new Intl.DateTimeFormat('id-ID', {
      month: 'short',
      year: 'numeric',
      timeZone: 'UTC',
    });

    const points = await Promise.all(
      Array.from({ length: months }, async (_, index) => {
        const monthOffset = index - (months - 1);
        const start = shiftMonthDateOnly(today, monthOffset);
        const end = monthOffset === 0 ? today : monthEndDateOnly(start);
        const startDate = parseDateOnly(start) as Date;
        const endDate = parseDateOnly(end) as Date;

        const [invoices, payments] = await Promise.all([
          this.prisma.invoice.aggregate({
            where: {
              businessId,
              cancelledAt: null,
              issueDate: { gte: startDate, lte: endDate },
            },
            _sum: { totalAmount: true },
            _count: { _all: true },
          }),
          this.prisma.payment.aggregate({
            where: {
              businessId,
              voidedAt: null,
              paymentDate: { gte: startDate, lte: endDate },
            },
            _sum: { amount: true },
          }),
        ]);

        return {
          key: start.slice(0, 7),
          label: formatter.format(startDate),
          invoiceTotal: invoices._sum.totalAmount ?? 0,
          invoiceCount: invoices._count._all,
          paymentsTotal: payments._sum.amount ?? 0,
        };
      }),
    );

    return points;
  }

  async getRentals(options: RentalReportOptions): Promise<RentalReportData> {
    const where = this.rentalWhere(options);
    const total = await this.prisma.rentalRecord.count({ where });
    const pagination = buildPagination(options.page, total, options.perPage);
    const rentals = await this.prisma.rentalRecord.findMany({
      where,
      orderBy: rentalOrderBy[options.sort],
      skip: (pagination.page - 1) * pagination.perPage,
      take: pagination.perPage,
      include: rentalReportInclude,
    });

    return {
      rows: rentals.map((rental) => this.mapRentalRow(rental)),
      pagination,
    };
  }

  async getInvoices(
    options: InvoiceReportOptions,
    period: { fromDate: Date; toDate: Date },
  ): Promise<{
    rows: InvoiceReportRow[];
    pagination: Pagination;
    summary: InvoiceGroupSummary;
  }> {
    const summary = await this.getInvoicePeriodSummary(options.businessId, period);
    const where = this.invoiceWhere(options);

    if (options.status) {
      const invoices = await this.prisma.invoice.findMany({
        where,
        orderBy: invoiceOrderBy[options.sort],
        include: invoiceReportInclude,
      });
      const rows = invoices
        .map((invoice) => this.mapInvoiceRow(invoice))
        .filter((row) => row.status === options.status);
      const pagination = buildPagination(options.page, rows.length, options.perPage);
      const offset = (pagination.page - 1) * pagination.perPage;

      return {
        rows: rows.slice(offset, offset + pagination.perPage),
        pagination,
        summary,
      };
    }

    const total = await this.prisma.invoice.count({ where });
    const pagination = buildPagination(options.page, total, options.perPage);
    const invoices = await this.prisma.invoice.findMany({
      where,
      orderBy: invoiceOrderBy[options.sort],
      skip: (pagination.page - 1) * pagination.perPage,
      take: pagination.perPage,
      include: invoiceReportInclude,
    });

    return {
      rows: invoices.map((invoice) => this.mapInvoiceRow(invoice)),
      pagination,
      summary,
    };
  }

  async getPayments(options: PaymentReportOptions): Promise<PaymentReportData> {
    const where = this.paymentWhere(options);
    const total = await this.prisma.payment.count({ where });
    const pagination = buildPagination(options.page, total, options.perPage);
    const payments = await this.prisma.payment.findMany({
      where,
      orderBy: paymentOrderBy[options.sort],
      skip: (pagination.page - 1) * pagination.perPage,
      take: pagination.perPage,
      include: paymentReportInclude,
    });

    return {
      rows: payments.map((payment) => this.mapPaymentRow(payment)),
      pagination,
      summary: await this.getPaymentSummary(options),
    };
  }

  async getReceivables(options: ReceivableReportOptions): Promise<ReceivableReportData> {
    const allRows = await this.loadReceivables(options.businessId, options.search);
    const groups = this.buildReceivableGroups(allRows);
    const filtered = options.aging ? allRows.filter((row) => row.group === options.aging) : allRows;
    const pagination = buildPagination(options.page, filtered.length, options.perPage);
    const offset = (pagination.page - 1) * pagination.perPage;
    const rows = filtered.slice(offset, offset + pagination.perPage);
    await this.attachReminderJobs(options.businessId, rows);

    return {
      rows,
      pagination,
      groups,
      totalOutstanding: filtered.reduce((total, row) => total + row.outstanding, 0),
    };
  }

  async getReminders(options: ReminderReportOptions): Promise<ReminderReportData> {
    const where = this.reminderWhere(options);
    const total = await this.prisma.reminderJob.count({ where });
    const pagination = buildPagination(options.page, total, options.perPage);
    const reminders = await this.prisma.reminderJob.findMany({
      where,
      orderBy: [{ scheduledDate: 'desc' }, { createdAt: 'desc' }],
      skip: (pagination.page - 1) * pagination.perPage,
      take: pagination.perPage,
      include: reminderReportInclude,
    });

    return {
      rows: reminders.map((reminder) => this.mapReminderRow(reminder)),
      pagination,
      summary: await this.getReminderSummary(options),
    };
  }

  async *exportRentals(options: RentalReportOptions): AsyncGenerator<CsvRow> {
    const where = this.rentalWhere(options);
    let cursor: string | undefined;
    while (true) {
      const rentals = await this.prisma.rentalRecord.findMany({
        where,
        orderBy: { id: 'asc' },
        take: EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: rentalReportInclude,
      });
      if (rentals.length === 0) {
        return;
      }
      for (const rental of rentals) {
        const row = this.mapRentalRow(rental);
        yield [
          row.rentalNumber,
          row.customerName,
          row.itemName,
          csvDate(row.startDate, this.timezone()),
          csvDate(row.endDate, this.timezone()),
          row.price,
          RENTAL_STATUS_LABELS[row.status] ?? row.status,
          row.invoiceCount,
          row.invoiceTotal,
          row.totalPaid,
          row.outstanding,
        ];
      }
      cursor = rentals[rentals.length - 1].id;
      if (rentals.length < EXPORT_BATCH_SIZE) {
        return;
      }
    }
  }

  async *exportInvoices(options: InvoiceReportOptions): AsyncGenerator<CsvRow> {
    const where = this.invoiceWhere(options);
    let cursor: string | undefined;
    while (true) {
      const invoices = await this.prisma.invoice.findMany({
        where,
        orderBy: { id: 'asc' },
        take: EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: invoiceReportInclude,
      });
      if (invoices.length === 0) {
        return;
      }
      for (const invoice of invoices) {
        const row = this.mapInvoiceRow(invoice);
        if (options.status && row.status !== options.status) {
          continue;
        }
        yield [
          row.invoiceNumber,
          row.customerName,
          row.rentalNumber,
          csvDate(row.issueDate, this.timezone()),
          csvDate(row.dueDate, this.timezone()),
          row.totalAmount,
          row.totalPaid,
          row.outstanding,
          statusLabelForCsv(row.status),
        ];
      }
      cursor = invoices[invoices.length - 1].id;
      if (invoices.length < EXPORT_BATCH_SIZE) {
        return;
      }
    }
  }

  async *exportPayments(options: PaymentReportOptions): AsyncGenerator<CsvRow> {
    const where = this.paymentWhere(options);
    let cursor: string | undefined;
    while (true) {
      const payments = await this.prisma.payment.findMany({
        where,
        orderBy: { id: 'asc' },
        take: EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: paymentReportInclude,
      });
      if (payments.length === 0) {
        return;
      }
      for (const payment of payments) {
        const row = this.mapPaymentRow(payment);
        yield [
          csvDate(row.paymentDate, this.timezone()),
          row.invoiceNumber,
          row.customerName,
          row.amount,
          PAYMENT_METHOD_LABELS[row.method] ?? row.method,
          row.reference ?? '',
          row.recordedBy,
          row.voidedAt ? 'Void' : 'Valid',
        ];
      }
      cursor = payments[payments.length - 1].id;
      if (payments.length < EXPORT_BATCH_SIZE) {
        return;
      }
    }
  }

  async *exportReceivables(options: ReceivableReportOptions): AsyncGenerator<CsvRow> {
    const where = this.receivableWhere(options.businessId, options.search);
    const paidByInvoice = await this.paymentSums(options.businessId);
    let cursor: string | undefined;
    while (true) {
      const invoices = await this.prisma.invoice.findMany({
        where,
        orderBy: { id: 'asc' },
        take: EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: receivableSelect,
      });
      if (invoices.length === 0) {
        return;
      }
      for (const invoice of invoices) {
        const row = this.mapReceivableRow(invoice, paidByInvoice.get(invoice.id) ?? 0);
        if (!row) {
          continue;
        }
        if (options.aging && row.group !== options.aging) {
          continue;
        }
        yield [
          row.invoiceNumber,
          row.customerName,
          row.customerWhatsApp,
          csvDate(row.issueDate, this.timezone()),
          csvDate(row.dueDate, this.timezone()),
          row.totalAmount,
          row.totalPaid,
          row.outstanding,
          row.daysLate,
          statusLabelForCsv(row.status),
        ];
      }
      cursor = invoices[invoices.length - 1].id;
      if (invoices.length < EXPORT_BATCH_SIZE) {
        return;
      }
    }
  }

  async *exportReminders(options: ReminderReportOptions): AsyncGenerator<CsvRow> {
    const where = this.reminderWhere(options);
    let cursor: string | undefined;
    while (true) {
      const reminders = await this.prisma.reminderJob.findMany({
        where,
        orderBy: { id: 'asc' },
        take: EXPORT_BATCH_SIZE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        include: reminderReportInclude,
      });
      if (reminders.length === 0) {
        return;
      }
      for (const reminder of reminders) {
        const row = this.mapReminderRow(reminder);
        yield [
          csvDate(row.scheduledDate, this.timezone()),
          row.invoiceNumber,
          row.customerName,
          getReminderRule(row.reminderType)?.label ?? row.reminderType,
          REMINDER_JOB_STATUS_LABELS[row.status] ?? row.status,
          this.reminderActivityLabel(row.contactStatus),
          csvDateTime(row.openedAt, this.timezone()),
          csvDateTime(row.sentAt, this.timezone()),
          row.activityUser,
        ];
      }
      cursor = reminders[reminders.length - 1].id;
      if (reminders.length < EXPORT_BATCH_SIZE) {
        return;
      }
    }
  }

  async getInvoicePeriodSummary(
    businessId: string,
    period: { fromDate: Date; toDate: Date },
  ): Promise<InvoiceGroupSummary> {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        businessId,
        issueDate: { gte: period.fromDate, lte: period.toDate },
      },
      select: {
        id: true,
        totalAmount: true,
        dueDate: true,
        cancelledAt: true,
        payments: {
          where: { voidedAt: null },
          select: { amount: true, voidedAt: true },
        },
      },
    });

    return summarizeInvoiceGroup(invoices, this.today(), this.timezone());
  }

  private rentalWhere(options: RentalReportOptions): Prisma.RentalRecordWhereInput {
    const where: Prisma.RentalRecordWhereInput = {
      businessId: options.businessId,
      startDate: { gte: options.from, lte: options.to },
    };
    if (options.status) {
      where.status = options.status;
    }
    if (options.search.length > 0) {
      where.OR = [
        { rentalNumber: { contains: options.search } },
        { customer: { name: { contains: options.search } } },
      ];
    }
    return where;
  }

  private invoiceWhere(options: InvoiceReportOptions): Prisma.InvoiceWhereInput {
    const where: Prisma.InvoiceWhereInput = {
      businessId: options.businessId,
      issueDate: { gte: options.from, lte: options.to },
    };
    if (options.dueFrom || options.dueTo) {
      where.dueDate = {
        ...(options.dueFrom ? { gte: options.dueFrom } : {}),
        ...(options.dueTo ? { lte: options.dueTo } : {}),
      };
    }
    if (options.search.length > 0) {
      where.OR = [
        { invoiceNumber: { contains: options.search } },
        { rentalRecord: { rentalNumber: { contains: options.search } } },
        { rentalRecord: { customer: { name: { contains: options.search } } } },
      ];
    }
    return where;
  }

  private paymentWhere(options: PaymentReportOptions): Prisma.PaymentWhereInput {
    const where: Prisma.PaymentWhereInput = {
      businessId: options.businessId,
      paymentDate: { gte: options.from, lte: options.to },
    };
    if (options.method) {
      where.method = options.method;
    }
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
    return where;
  }

  private reminderWhere(options: ReminderReportOptions): Prisma.ReminderJobWhereInput {
    const where: Prisma.ReminderJobWhereInput = {
      businessId: options.businessId,
      scheduledDate: { gte: options.from, lte: options.to },
    };
    if (options.type) {
      where.reminderType = options.type;
    }
    if (options.search.length > 0) {
      where.invoice = {
        OR: [
          { invoiceNumber: { contains: options.search } },
          { rentalRecord: { customer: { name: { contains: options.search } } } },
        ],
      };
    }
    return where;
  }

  private receivableWhere(businessId: string, search: string): Prisma.InvoiceWhereInput {
    const where: Prisma.InvoiceWhereInput = {
      businessId,
      cancelledAt: null,
    };
    if (search.length > 0) {
      where.OR = [
        { invoiceNumber: { contains: search } },
        { rentalRecord: { customer: { name: { contains: search } } } },
      ];
    }
    return where;
  }

  private mapRentalRow(rental: RentalReportRecord): RentalReportRow {
    const financials = summarizeRentalInvoices(rental.invoices);
    return {
      id: rental.id,
      rentalNumber: rental.rentalNumber,
      customerName: rental.customer.name,
      itemName: rental.itemName,
      startDate: rental.startDate,
      endDate: rental.endDate,
      price: rental.price,
      status: rental.status as RentalStatus,
      invoiceCount: financials.invoiceCount,
      invoiceTotal: financials.totalBilled,
      totalPaid: financials.totalPaid,
      outstanding: financials.outstanding,
    };
  }

  private mapInvoiceRow(invoice: InvoiceReportRecord): InvoiceReportRow {
    const summary = summarizeInvoice(invoice, this.today(), this.timezone());
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerName: invoice.rentalRecord.customer.name,
      rentalNumber: invoice.rentalRecord.rentalNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount,
      totalPaid: summary.totalPaid,
      outstanding: summary.outstanding,
      status: summary.status,
    };
  }

  private mapPaymentRow(payment: PaymentReportRecord): PaymentReportRow {
    return {
      id: payment.id,
      invoiceId: payment.invoice.id,
      paymentDate: payment.paymentDate,
      invoiceNumber: payment.invoice.invoiceNumber,
      customerName: payment.invoice.rentalRecord.customer.name,
      amount: payment.amount,
      method: payment.method as PaymentMethod,
      reference: payment.reference,
      recordedBy: payment.recordedBy.name,
      voidedAt: payment.voidedAt,
      voidReason: payment.voidReason,
    };
  }

  private async loadReceivables(
    businessId: string,
    search: string,
  ): Promise<ReceivableReportRow[]> {
    const where = this.receivableWhere(businessId, search);
    const paidByInvoice = await this.paymentSums(businessId);
    const rows: ReceivableReportRow[] = [];
    let cursor: string | undefined;

    while (true) {
      const invoices = await this.prisma.invoice.findMany({
        where,
        orderBy: { id: 'asc' },
        take: 500,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        select: receivableSelect,
      });

      if (invoices.length === 0) {
        break;
      }

      for (const invoice of invoices) {
        const row = this.mapReceivableRow(invoice, paidByInvoice.get(invoice.id) ?? 0);
        if (row) {
          rows.push(row);
        }
      }

      cursor = invoices[invoices.length - 1].id;
      if (invoices.length < 500) {
        break;
      }
    }

    return rows.sort((left, right) => {
      const due = left.dueDate.getTime() - right.dueDate.getTime();
      return due !== 0 ? due : left.invoiceNumber.localeCompare(right.invoiceNumber);
    });
  }

  private async paymentSums(businessId: string): Promise<Map<string, number>> {
    const groups = await this.prisma.payment.groupBy({
      by: ['invoiceId'],
      where: { businessId, voidedAt: null },
      _sum: { amount: true },
    });

    return new Map(groups.map((group) => [group.invoiceId, group._sum.amount ?? 0]));
  }

  private async attachReminderJobs(businessId: string, rows: ReceivableReportRow[]): Promise<void> {
    if (rows.length === 0) {
      return;
    }

    const reminders = await this.prisma.reminderJob.findMany({
      where: {
        businessId,
        invoiceId: { in: rows.map((row) => row.id) },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, invoiceId: true },
    });
    const latest = new Map<string, string>();
    for (const reminder of reminders) {
      if (!latest.has(reminder.invoiceId)) {
        latest.set(reminder.invoiceId, reminder.id);
      }
    }
    for (const row of rows) {
      row.reminderJobId = latest.get(row.id) ?? null;
    }
  }

  private mapReceivableRow(
    invoice: ReceivableRecord,
    totalPaid: number,
  ): ReceivableReportRow | null {
    const summary = summarizeInvoice(
      {
        totalAmount: invoice.totalAmount,
        dueDate: invoice.dueDate,
        cancelledAt: invoice.cancelledAt,
        payments: totalPaid > 0 ? [{ amount: totalPaid, voidedAt: null }] : [],
      },
      this.today(),
      this.timezone(),
    );
    if (invoice.cancelledAt || summary.outstanding <= 0) {
      return null;
    }

    const dueDateOnly = dateOnlyInTimezone(invoice.dueDate, this.timezone());
    const aging = receivableGroupFor(dueDateOnly, this.today());

    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.rentalRecord.customer.id,
      customerName: invoice.rentalRecord.customer.name,
      customerWhatsApp: invoice.rentalRecord.customer.whatsappNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      totalAmount: invoice.totalAmount,
      totalPaid: summary.totalPaid,
      outstanding: summary.outstanding,
      daysLate: aging.daysLate,
      group: aging.key,
      status: summary.status,
      reminderJobId: null,
    };
  }

  private buildReceivableGroups(rows: ReceivableReportRow[]): ReceivableGroupSummary[] {
    return RECEIVABLE_GROUPS.map((group) => {
      const matching = rows.filter((row) => row.group === group.key);
      return {
        key: group.key,
        label: group.label,
        className: group.className,
        count: matching.length,
        totalOutstanding: matching.reduce((total, row) => total + row.outstanding, 0),
      };
    });
  }

  private mapReminderRow(reminder: ReminderReportRecord): ReminderReportRow {
    const opened = [...reminder.activities]
      .reverse()
      .find((activity) => activity.activityType === 'WHATSAPP_OPENED');
    const sent = [...reminder.activities]
      .reverse()
      .find((activity) => activity.activityType === 'MARKED_SENT');
    const activityUser = sent?.user?.name ?? opened?.user?.name ?? 'Scheduler';

    return {
      id: reminder.id,
      scheduledDate: reminder.scheduledDate,
      invoiceNumber: reminder.invoice.invoiceNumber,
      customerName: reminder.invoice.rentalRecord.customer.name,
      reminderType: reminder.reminderType as ReminderType,
      status: reminder.status as ReminderJobStatus,
      contactStatus: deriveContactStatus(reminder.activities),
      openedAt: opened?.createdAt ?? null,
      sentAt: sent?.createdAt ?? null,
      activityUser,
    };
  }

  private async getPaymentSummary(options: PaymentReportOptions): Promise<PaymentReportSummary> {
    const baseWhere: Prisma.PaymentWhereInput = {
      businessId: options.businessId,
      paymentDate: { gte: options.from, lte: options.to },
    };

    const [valid, voided, transactionCount, methodGroups] = await Promise.all([
      this.prisma.payment.aggregate({
        where: { ...baseWhere, voidedAt: null },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.payment.aggregate({
        where: { ...baseWhere, voidedAt: { not: null } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      this.prisma.payment.count({ where: baseWhere }),
      this.prisma.payment.groupBy({
        by: ['method'],
        where: { ...baseWhere, voidedAt: null },
        _sum: { amount: true },
        _count: { _all: true },
      }),
    ]);

    const summary = emptyPaymentSummary();
    summary.totalValid = valid._sum.amount ?? 0;
    summary.validCount = valid._count._all;
    summary.totalVoid = voided._sum.amount ?? 0;
    summary.voidCount = voided._count._all;
    summary.transactionCount = transactionCount;

    for (const group of methodGroups) {
      if (!PAYMENT_METHODS.includes(group.method as PaymentMethod)) {
        continue;
      }
      summary.methods[group.method as PaymentMethod] = {
        total: group._sum.amount ?? 0,
        count: group._count._all,
      };
    }

    return summary;
  }

  private async getReminderSummary(options: ReminderReportOptions): Promise<ReminderReportSummary> {
    const where = this.reminderWhere(options);
    const activityWhere: Prisma.ReminderActivityWhereInput = {
      businessId: options.businessId,
      activityType: { in: ['WHATSAPP_OPENED', 'MARKED_SENT'] },
      reminder: where,
    };

    const [statusGroups, activityGroups] = await Promise.all([
      this.prisma.reminderJob.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
      }),
      this.prisma.reminderActivity.groupBy({
        by: ['activityType'],
        where: activityWhere,
        _count: { _all: true },
      }),
    ]);

    const statusCount = (status: string): number =>
      statusGroups.find((group) => group.status === status)?._count._all ?? 0;
    const activityCount = (type: string): number =>
      activityGroups.find((group) => group.activityType === type)?._count._all ?? 0;

    const pendingCount = statusCount('PENDING');
    const readyCount = statusCount('READY');
    const skippedCount = statusCount('SKIPPED');

    return {
      createdCount: pendingCount + readyCount + skippedCount,
      pendingCount,
      readyCount,
      skippedCount,
      openedCount: activityCount('WHATSAPP_OPENED'),
      sentCount: activityCount('MARKED_SENT'),
    };
  }

  private reminderActivityLabel(contactStatus: string): string {
    if (contactStatus === 'SENT') {
      return 'Ditandai terkirim (manual)';
    }
    return (
      REMINDER_CONTACT_STATUS_LABELS[
        contactStatus as keyof typeof REMINDER_CONTACT_STATUS_LABELS
      ] ?? contactStatus
    );
  }

  private timezone(): string {
    return this.configService.get<string>('app.timezone') ?? 'Asia/Jakarta';
  }

  private today(): string {
    return todayDateOnly(this.timezone());
  }
}
