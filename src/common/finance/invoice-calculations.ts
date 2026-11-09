import { dateOnlyInTimezone } from '../helpers/date-only.js';

export type InvoiceStatus = 'UNPAID' | 'PARTIAL' | 'PAID' | 'OVERDUE' | 'CANCELLED';

export interface PaymentSnapshot {
  amount: number;
  voidedAt: Date | null;
}

export interface InvoiceSnapshot {
  totalAmount: number;
  dueDate: Date;
  cancelledAt: Date | null;
  payments: PaymentSnapshot[];
}

export interface InvoiceSummary {
  totalPaid: number;
  outstanding: number;
  status: InvoiceStatus;
  isOverdue: boolean;
}

export interface InvoiceAggregate {
  billedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  unpaidCount: number;
  partialCount: number;
  overdueCount: number;
  paidCount: number;
  cancelledCount: number;
}

export function sumValidPayments(payments: PaymentSnapshot[]): number {
  return payments
    .filter((payment) => payment.voidedAt === null)
    .reduce((total, payment) => total + payment.amount, 0);
}

export function summarizeInvoice(
  invoice: InvoiceSnapshot,
  todayDate: string,
  timeZone: string,
): InvoiceSummary {
  const totalPaid = sumValidPayments(invoice.payments);
  const cancelled = invoice.cancelledAt !== null;
  const dueDate = dateOnlyInTimezone(invoice.dueDate, timeZone);
  const isPastDue = dueDate < todayDate;

  if (cancelled) {
    return { totalPaid, outstanding: 0, status: 'CANCELLED', isOverdue: false };
  }

  const outstanding = Math.max(0, invoice.totalAmount - totalPaid);

  if (outstanding === 0) {
    return { totalPaid, outstanding: 0, status: 'PAID', isOverdue: false };
  }

  if (isPastDue) {
    return { totalPaid, outstanding, status: 'OVERDUE', isOverdue: true };
  }

  if (totalPaid > 0) {
    return { totalPaid, outstanding, status: 'PARTIAL', isOverdue: false };
  }

  return { totalPaid, outstanding, status: 'UNPAID', isOverdue: false };
}

export function aggregateInvoices(
  invoices: InvoiceSnapshot[],
  todayDate: string,
  timeZone: string,
): InvoiceAggregate {
  const aggregate: InvoiceAggregate = {
    billedAmount: 0,
    paidAmount: 0,
    outstandingAmount: 0,
    unpaidCount: 0,
    partialCount: 0,
    overdueCount: 0,
    paidCount: 0,
    cancelledCount: 0,
  };

  for (const invoice of invoices) {
    const summary = summarizeInvoice(invoice, todayDate, timeZone);

    if (summary.status === 'CANCELLED') {
      aggregate.cancelledCount += 1;
      continue;
    }

    aggregate.billedAmount += invoice.totalAmount;
    aggregate.paidAmount += summary.totalPaid;
    aggregate.outstandingAmount += summary.outstanding;

    switch (summary.status) {
      case 'UNPAID':
        aggregate.unpaidCount += 1;
        break;
      case 'PARTIAL':
        aggregate.partialCount += 1;
        break;
      case 'OVERDUE':
        aggregate.overdueCount += 1;
        break;
      case 'PAID':
        aggregate.paidCount += 1;
        break;
    }
  }

  return aggregate;
}
