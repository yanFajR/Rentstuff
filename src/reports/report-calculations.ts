import {
  summarizeInvoice,
  type InvoiceSnapshot,
  type InvoiceStatus,
} from '../common/finance/invoice-calculations.js';
import { parseDateOnly } from '../common/helpers/date-only.js';

export interface ReportInvoiceSnapshot extends InvoiceSnapshot {
  id: string;
}

export interface InvoiceGroupSummary {
  invoiceCount: number;
  activeInvoiceCount: number;
  cancelledCount: number;
  totalIssued: number;
  paidCount: number;
  unpaidCount: number;
  partialCount: number;
  overdueCount: number;
}

export function summarizeInvoiceGroup(
  invoices: Array<InvoiceSnapshot & { id?: string }>,
  todayDate: string,
  timeZone: string,
): InvoiceGroupSummary {
  const summary: InvoiceGroupSummary = {
    invoiceCount: invoices.length,
    activeInvoiceCount: 0,
    cancelledCount: 0,
    totalIssued: 0,
    paidCount: 0,
    unpaidCount: 0,
    partialCount: 0,
    overdueCount: 0,
  };

  for (const invoice of invoices) {
    const calculated = summarizeInvoice(invoice, todayDate, timeZone);
    if (calculated.status === 'CANCELLED') {
      summary.cancelledCount += 1;
      continue;
    }

    summary.activeInvoiceCount += 1;
    summary.totalIssued += invoice.totalAmount;
    switch (calculated.status) {
      case 'PAID':
        summary.paidCount += 1;
        break;
      case 'PARTIAL':
        summary.partialCount += 1;
        break;
      case 'OVERDUE':
        summary.overdueCount += 1;
        break;
      case 'UNPAID':
        summary.unpaidCount += 1;
        break;
    }
  }

  return summary;
}

export function summarizeRentalInvoices(
  invoices: Array<{
    totalAmount: number;
    cancelledAt?: Date | null;
    payments: Array<{ amount: number; voidedAt: Date | null }>;
  }>,
): {
  invoiceCount: number;
  totalBilled: number;
  totalPaid: number;
  outstanding: number;
} {
  let totalBilled = 0;
  let totalPaid = 0;
  let outstanding = 0;

  for (const invoice of invoices) {
    if (invoice.cancelledAt) {
      continue;
    }
    const paid = invoice.payments
      .filter((payment) => payment.voidedAt === null)
      .reduce((total, payment) => total + payment.amount, 0);
    totalBilled += invoice.totalAmount;
    totalPaid += paid;
    outstanding += Math.max(0, invoice.totalAmount - paid);
  }

  return {
    invoiceCount: invoices.length,
    totalBilled,
    totalPaid,
    outstanding,
  };
}

export const RECEIVABLE_GROUPS = [
  { key: 'not_due', label: 'Belum jatuh tempo', className: 'bg-slate-100 text-slate-600' },
  { key: 'due_today', label: 'Jatuh tempo hari ini', className: 'bg-brand-50 text-brand-700' },
  { key: 'overdue_1_7', label: 'Terlambat 1–7 hari', className: 'bg-amber-50 text-amber-700' },
  { key: 'overdue_8_30', label: 'Terlambat 8–30 hari', className: 'bg-orange-50 text-orange-700' },
  {
    key: 'overdue_30_plus',
    label: 'Terlambat lebih dari 30 hari',
    className: 'bg-rose-50 text-rose-700',
  },
] as const;

export type ReceivableGroupKey = (typeof RECEIVABLE_GROUPS)[number]['key'];

export function isReceivableGroup(value: unknown): value is ReceivableGroupKey {
  return typeof value === 'string' && RECEIVABLE_GROUPS.some((group) => group.key === value);
}

export function daysLate(dueDateOnly: string, todayDate: string): number {
  const due = parseDateOnly(dueDateOnly);
  const today = parseDateOnly(todayDate);
  if (!due || !today) {
    return 0;
  }
  return Math.max(0, Math.floor((today.getTime() - due.getTime()) / 86_400_000));
}

export function receivableGroupFor(
  dueDateOnly: string,
  todayDate: string,
): { key: ReceivableGroupKey; daysLate: number } {
  if (dueDateOnly > todayDate) {
    return { key: 'not_due', daysLate: 0 };
  }
  if (dueDateOnly === todayDate) {
    return { key: 'due_today', daysLate: 0 };
  }

  const lateDays = daysLate(dueDateOnly, todayDate);
  if (lateDays <= 7) {
    return { key: 'overdue_1_7', daysLate: lateDays };
  }
  if (lateDays <= 30) {
    return { key: 'overdue_8_30', daysLate: lateDays };
  }
  return { key: 'overdue_30_plus', daysLate: lateDays };
}

export function statusLabelForCsv(status: InvoiceStatus): string {
  switch (status) {
    case 'UNPAID':
      return 'Belum dibayar';
    case 'PARTIAL':
      return 'Dibayar sebagian';
    case 'PAID':
      return 'Lunas';
    case 'OVERDUE':
      return 'Terlambat';
    case 'CANCELLED':
      return 'Dibatalkan';
  }
}
