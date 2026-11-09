import { Injectable } from '@nestjs/common';

import type { InvoiceAggregate } from '../common/finance/invoice-calculations.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { InvoiceService, type InvoiceRowWithSummary } from '../invoices/invoice.service.js';
import { PaymentService, type PaymentListRow } from '../payments/payment.service.js';
import {
  ReminderService,
  type ReminderRowWithDerived,
  type ReminderSummaryCounts,
} from '../reminders/reminder.service.js';
import { ReportService } from '../reports/reports.service.js';
import type { MonthlyTrendPoint } from '../reports/report-types.js';

export type MetricFormat = 'number' | 'currency';

export interface DashboardMetric {
  key: string;
  label: string;
  value: number;
  format: MetricFormat;
  icon: string;
  stage: number;
  available: boolean;
  caption: string;
}

export interface DashboardOverview {
  generatedAt: Date;
  metrics: DashboardMetric[];
  financials: InvoiceAggregate;
  recentInvoices: InvoiceRowWithSummary[];
  recentPayments: PaymentListRow[];
  reminderSummary: ReminderSummaryCounts;
  recentReminders: ReminderRowWithDerived[];
  monthlyTrend: MonthlyTrendPoint[];
}

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly invoiceService: InvoiceService,
    private readonly paymentService: PaymentService,
    private readonly reminderService: ReminderService,
    private readonly reportService: ReportService,
  ) {}

  async getOverview(businessId: string): Promise<DashboardOverview> {
    const [
      customers,
      activeRentals,
      financials,
      recentInvoices,
      recentPayments,
      reminderSummary,
      recentReminders,
      monthlyTrend,
    ] = await Promise.all([
      this.prisma.customer.count({ where: { businessId, archivedAt: null } }),
      this.prisma.rentalRecord.count({ where: { businessId, status: 'ACTIVE' } }),
      this.invoiceService.getFinancialSummary(businessId),
      this.invoiceService.getRecent(businessId, 5),
      this.paymentService.getRecent(businessId, 5),
      this.reminderService.getSummary(businessId),
      this.reminderService.getRecent(businessId, 5),
      this.reportService.getMonthlyTrend(businessId),
    ]);

    return {
      generatedAt: new Date(),
      metrics: [
        {
          key: 'outstandingAmount',
          label: 'Tagihan Belum Lunas',
          value: financials.outstandingAmount,
          format: 'currency',
          icon: 'invoice',
          stage: 4,
          available: true,
          caption: 'Total sisa piutang',
        },
        {
          key: 'receivedAmount',
          label: 'Pembayaran Diterima',
          value: financials.paidAmount,
          format: 'currency',
          icon: 'wallet',
          stage: 4,
          available: true,
          caption: 'Pembayaran valid',
        },
        {
          key: 'unpaidInvoices',
          label: 'Tagihan Belum Dibayar',
          value: financials.unpaidCount,
          format: 'number',
          icon: 'invoice',
          stage: 4,
          available: true,
          caption: 'Belum ada pembayaran',
        },
        {
          key: 'partialInvoices',
          label: 'Tagihan Dibayar Sebagian',
          value: financials.partialCount,
          format: 'number',
          icon: 'trend',
          stage: 4,
          available: true,
          caption: 'Sudah dibayar sebagian',
        },
        {
          key: 'overdueInvoices',
          label: 'Tagihan Terlambat',
          value: financials.overdueCount,
          format: 'number',
          icon: 'alert',
          stage: 4,
          available: true,
          caption: 'Melewati jatuh tempo',
        },
        {
          key: 'paidInvoices',
          label: 'Tagihan Lunas',
          value: financials.paidCount,
          format: 'number',
          icon: 'check',
          stage: 4,
          available: true,
          caption: 'Sudah lunas',
        },
        {
          key: 'customers',
          label: 'Pelanggan',
          value: customers,
          format: 'number',
          icon: 'users',
          stage: 3,
          available: true,
          caption: 'Pelanggan aktif',
        },
        {
          key: 'activeRentals',
          label: 'Penyewaan Aktif',
          value: activeRentals,
          format: 'number',
          icon: 'calendar',
          stage: 3,
          available: true,
          caption: 'Sedang berjalan',
        },
      ],
      financials,
      recentInvoices,
      recentPayments,
      reminderSummary,
      recentReminders,
      monthlyTrend,
    };
  }
}
