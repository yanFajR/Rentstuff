import type { InvoiceStatus } from '../common/finance/invoice-calculations.js';
import type { Pagination } from '../common/helpers/pagination.js';
import type { PaymentMethod } from '../payments/payment-method.js';
import type { RentalStatus } from '../rentals/rental-status.js';
import type { ReminderJobStatus, ReminderType } from '../reminders/reminder-rules.js';
import type { ReminderContactStatus } from '../reminders/reminder-status.js';
import type { InvoiceGroupSummary, ReceivableGroupKey } from './report-calculations.js';

export const REPORT_TABS = [
  'summary',
  'rentals',
  'invoices',
  'payments',
  'receivables',
  'reminders',
] as const;

export type ReportTab = (typeof REPORT_TABS)[number];

export const REPORT_TAB_LABELS: Record<ReportTab, string> = {
  summary: 'Ringkasan',
  rentals: 'Penyewaan',
  invoices: 'Tagihan',
  payments: 'Pembayaran',
  receivables: 'Piutang',
  reminders: 'Pengingat',
};

export interface MonthlyTrendPoint {
  key: string;
  label: string;
  invoiceTotal: number;
  invoiceCount: number;
  paymentsTotal: number;
}

export interface SummaryReport {
  invoiceTotal: number;
  invoiceCount: number;
  activeInvoiceCount: number;
  cancelledCount: number;
  paidCount: number;
  unpaidCount: number;
  partialCount: number;
  overdueCount: number;
  paymentsTotal: number;
  paymentsCount: number;
  outstanding: number;
  previousPaymentsTotal: number;
  paymentChangePercent: number | null;
  trend: MonthlyTrendPoint[];
}

export interface RentalReportRow {
  id: string;
  rentalNumber: string;
  customerName: string;
  itemName: string;
  startDate: Date;
  endDate: Date;
  price: number;
  status: RentalStatus;
  invoiceCount: number;
  invoiceTotal: number;
  totalPaid: number;
  outstanding: number;
}

export interface RentalReportOptions {
  businessId: string;
  from: Date;
  to: Date;
  search: string;
  status: RentalStatus | null;
  sort: RentalReportSort;
  page: number;
  perPage: number;
}

export const RENTAL_REPORT_SORTS = ['start_desc', 'start_asc', 'created_desc'] as const;
export type RentalReportSort = (typeof RENTAL_REPORT_SORTS)[number];

export interface InvoiceReportRow {
  id: string;
  invoiceNumber: string;
  customerName: string;
  rentalNumber: string;
  issueDate: Date;
  dueDate: Date;
  totalAmount: number;
  totalPaid: number;
  outstanding: number;
  status: InvoiceStatus;
}

export interface InvoiceReportOptions {
  businessId: string;
  from: Date;
  to: Date;
  dueFrom: Date | null;
  dueTo: Date | null;
  search: string;
  status: InvoiceStatus | null;
  sort: InvoiceReportSort;
  page: number;
  perPage: number;
}

export const INVOICE_REPORT_SORTS = [
  'issue_desc',
  'issue_asc',
  'due_asc',
  'due_desc',
  'total_desc',
] as const;
export type InvoiceReportSort = (typeof INVOICE_REPORT_SORTS)[number];

export interface PaymentMethodSummary {
  total: number;
  count: number;
}

export interface PaymentReportSummary {
  totalValid: number;
  validCount: number;
  totalVoid: number;
  voidCount: number;
  transactionCount: number;
  methods: Record<PaymentMethod, PaymentMethodSummary>;
}

export interface PaymentReportRow {
  id: string;
  invoiceId: string;
  paymentDate: Date;
  invoiceNumber: string;
  customerName: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  recordedBy: string;
  voidedAt: Date | null;
  voidReason: string | null;
}

export interface PaymentReportOptions {
  businessId: string;
  from: Date;
  to: Date;
  search: string;
  method: PaymentMethod | null;
  status: 'valid' | 'void' | null;
  sort: PaymentReportSort;
  page: number;
  perPage: number;
}

export const PAYMENT_REPORT_SORTS = ['date_desc', 'date_asc', 'amount_desc'] as const;
export type PaymentReportSort = (typeof PAYMENT_REPORT_SORTS)[number];

export interface ReceivableReportRow {
  id: string;
  invoiceNumber: string;
  customerId: string;
  customerName: string;
  customerWhatsApp: string;
  issueDate: Date;
  dueDate: Date;
  totalAmount: number;
  totalPaid: number;
  outstanding: number;
  daysLate: number;
  group: ReceivableGroupKey;
  status: InvoiceStatus;
  reminderJobId: string | null;
}

export interface ReceivableGroupSummary {
  key: ReceivableGroupKey;
  label: string;
  className: string;
  count: number;
  totalOutstanding: number;
}

export interface ReceivableReportOptions {
  businessId: string;
  search: string;
  aging: ReceivableGroupKey | null;
  page: number;
  perPage: number;
}

export interface ReminderReportRow {
  id: string;
  scheduledDate: Date;
  invoiceNumber: string;
  customerName: string;
  reminderType: ReminderType;
  status: ReminderJobStatus;
  contactStatus: ReminderContactStatus;
  openedAt: Date | null;
  sentAt: Date | null;
  activityUser: string;
}

export interface ReminderReportSummary {
  createdCount: number;
  pendingCount: number;
  readyCount: number;
  skippedCount: number;
  openedCount: number;
  sentCount: number;
}

export interface ReminderReportOptions {
  businessId: string;
  from: Date;
  to: Date;
  search: string;
  type: ReminderType | null;
  page: number;
  perPage: number;
}

export interface InvoiceSummaryReport {
  summary: InvoiceGroupSummary;
  rows: InvoiceReportRow[];
  pagination: Pagination;
}

export interface RentalReportData {
  rows: RentalReportRow[];
  pagination: Pagination;
}

export interface PaymentReportData {
  rows: PaymentReportRow[];
  pagination: Pagination;
  summary: PaymentReportSummary;
}

export interface ReceivableReportData {
  rows: ReceivableReportRow[];
  pagination: Pagination;
  groups: ReceivableGroupSummary[];
  totalOutstanding: number;
}

export interface ReminderReportData {
  rows: ReminderReportRow[];
  pagination: Pagination;
  summary: ReminderReportSummary;
}
