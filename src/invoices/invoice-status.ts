import type { InvoiceStatus } from '../common/finance/invoice-calculations.js';

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  'UNPAID',
  'PARTIAL',
  'PAID',
  'OVERDUE',
  'CANCELLED',
];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  UNPAID: 'Belum dibayar',
  PARTIAL: 'Dibayar sebagian',
  PAID: 'Lunas',
  OVERDUE: 'Terlambat',
  CANCELLED: 'Dibatalkan',
};

export const INVOICE_STATUS_CLASSES: Record<InvoiceStatus, string> = {
  UNPAID: 'bg-slate-100 text-slate-600',
  PARTIAL: 'bg-amber-50 text-amber-700',
  PAID: 'bg-emerald-50 text-emerald-700',
  OVERDUE: 'bg-rose-50 text-rose-700',
  CANCELLED: 'bg-slate-100 text-slate-400',
};

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === 'string' && (INVOICE_STATUSES as readonly string[]).includes(value);
}

export function formatInvoiceNumber(sequence: number): string {
  return `INV-${String(Math.max(1, Math.floor(sequence))).padStart(5, '0')}`;
}
