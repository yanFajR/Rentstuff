import { jest } from '@jest/globals';

import type { PrismaService } from '../common/prisma/prisma.service.js';
import type { InvoiceService } from '../invoices/invoice.service.js';
import type { PaymentService } from '../payments/payment.service.js';
import type { ReminderService } from '../reminders/reminder.service.js';
import type { ReportService } from '../reports/reports.service.js';
import { DashboardService } from './dashboard.service.js';

type AnyFunction = (...args: any[]) => any;

describe('DashboardService', () => {
  it('menggabungkan data operasional dan keuangan per bisnis', async () => {
    const prismaMock = {
      customer: { count: jest.fn<AnyFunction>(async () => 3) },
      rentalRecord: {
        count: jest
          .fn<AnyFunction>()
          .mockResolvedValueOnce(2)
          .mockResolvedValueOnce(1)
          .mockResolvedValueOnce(4),
      },
    };

    const invoiceServiceMock = {
      getFinancialSummary: jest.fn<AnyFunction>(async () => ({
        billedAmount: 3_000_000,
        paidAmount: 1_500_000,
        outstandingAmount: 1_500_000,
        unpaidCount: 2,
        partialCount: 1,
        overdueCount: 1,
        paidCount: 0,
        cancelledCount: 0,
      })),
      getRecent: jest.fn<AnyFunction>(async () => [
        {
          id: 'invoice-1',
          invoiceNumber: 'INV-00001',
          totalAmount: 1_500_000,
          dueDate: new Date('2026-11-15T00:00:00Z'),
          cancelledAt: null,
          payments: [],
          rentalRecord: { customer: { name: 'Budi' } },
          summary: {
            totalPaid: 0,
            outstanding: 1_500_000,
            status: 'UNPAID',
            isOverdue: false,
          },
        },
      ]),
    };

    const paymentServiceMock = {
      getRecent: jest.fn<AnyFunction>(async () => [
        {
          id: 'payment-1',
          amount: 500_000,
          voidedAt: null,
          paymentDate: new Date('2026-11-10T00:00:00Z'),
          invoice: { invoiceNumber: 'INV-00001' },
        },
      ]),
    };

    const reminderServiceMock = {
      getSummary: jest.fn<AnyFunction>(async () => ({
        upcoming: 2,
        dueToday: 1,
        overdue: 1,
        notContacted: 3,
        sent: 1,
        totalActive: 4,
      })),
      getRecent: jest.fn<AnyFunction>(async () => [
        {
          id: 'reminder-1',
          status: 'READY',
          scheduledDate: new Date('2026-11-15T00:00:00Z'),
          reminderType: 'H_MINUS_3',
          contactStatus: 'PENDING',
          timingCategory: 'UPCOMING',
          invoice: {
            invoiceNumber: 'INV-00001',
            rentalRecord: { customer: { name: 'Budi' } },
          },
        },
      ]),
    };

    const reportServiceMock = {
      getMonthlyTrend: jest.fn<AnyFunction>(async () => [
        {
          key: '2026-11',
          label: 'Nov 2026',
          invoiceTotal: 2_000_000,
          invoiceCount: 2,
          paymentsTotal: 1_500_000,
        },
      ]),
    };

    const service = new DashboardService(
      prismaMock as unknown as PrismaService,
      invoiceServiceMock as unknown as InvoiceService,
      paymentServiceMock as unknown as PaymentService,
      reminderServiceMock as unknown as ReminderService,
      reportServiceMock as unknown as ReportService,
    );

    const overview = await service.getOverview('business-1');

    expect(overview.metrics.map((metric) => [metric.label, metric.value])).toEqual([
      ['Tagihan Belum Lunas', 1_500_000],
      ['Pembayaran Diterima', 1_500_000],
      ['Tagihan Belum Dibayar', 2],
      ['Tagihan Dibayar Sebagian', 1],
      ['Tagihan Terlambat', 1],
      ['Tagihan Lunas', 0],
      ['Pelanggan', 3],
      ['Penyewaan Aktif', 2],
    ]);
    expect(overview.recentInvoices).toHaveLength(1);
    expect(overview.recentPayments).toHaveLength(1);
    expect(overview.reminderSummary).toMatchObject({
      notContacted: 3,
      dueToday: 1,
      overdue: 1,
      sent: 1,
    });
    expect(overview.recentReminders).toHaveLength(1);
    expect(overview.monthlyTrend).toHaveLength(1);
    expect(overview.monthlyTrend[0]).toMatchObject({
      invoiceTotal: 2_000_000,
      paymentsTotal: 1_500_000,
    });
    expect(invoiceServiceMock.getFinancialSummary).toHaveBeenCalledWith('business-1');
    expect(reminderServiceMock.getSummary).toHaveBeenCalledWith('business-1');
    expect(prismaMock.customer.count).toHaveBeenCalledWith({
      where: { businessId: 'business-1', archivedAt: null },
    });
  });
});
