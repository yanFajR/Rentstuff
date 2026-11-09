import { Controller, Get, NotFoundException, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import type { AuthenticationContext } from '../common/auth/authenticated-request.js';
import { CurrentAuth } from '../common/auth/current-auth.decorator.js';
import { TenantAuthGuard } from '../common/auth/tenant-auth.guard.js';
import { parseDateOnly, todayDateOnly } from '../common/helpers/date-only.js';
import { readOneOf, readPage, readString } from '../common/helpers/query.js';
import type { InvoiceStatus } from '../common/finance/invoice-calculations.js';
import { isInvoiceStatus } from '../invoices/invoice-status.js';
import { isPaymentMethod, type PaymentMethod } from '../payments/payment-method.js';
import { isRentalStatus, type RentalStatus } from '../rentals/rental-status.js';
import { isReminderType, type ReminderType } from '../reminders/reminder-rules.js';
import { isReceivableGroup, type ReceivableGroupKey } from './report-calculations.js';
import { streamCsv, type CsvRow } from './report-csv.js';
import {
  REPORT_PERIODS,
  REPORT_PERIOD_LABELS,
  resolveReportPeriod,
  type ResolvedReportPeriod,
} from './report-period.js';
import {
  INVOICE_REPORT_SORTS,
  PAYMENT_REPORT_SORTS,
  RENTAL_REPORT_SORTS,
  REPORT_TABS,
  REPORT_TAB_LABELS,
  type InvoiceReportSort,
  type PaymentReportSort,
  type RentalReportSort,
  type ReportTab,
} from './report-types.js';
import { ReportService, REPORT_CSV_HEADERS } from './reports.service.js';

const PER_PAGE = 10;
const EXPORT_TYPES = ['rentals', 'invoices', 'payments', 'receivables', 'reminders'] as const;

type ReportExportType = (typeof EXPORT_TYPES)[number];

interface ParsedReportFilters {
  search: string;
  page: number;
  error: string;
  dueFrom: Date | null;
  dueTo: Date | null;
  rentalStatus: RentalStatus | null;
  invoiceStatus: InvoiceStatus | null;
  paymentMethod: PaymentMethod | null;
  paymentStatus: 'valid' | 'void' | null;
  aging: ReceivableGroupKey | null;
  reminderType: ReminderType | null;
  rentalSort: RentalReportSort;
  invoiceSort: InvoiceReportSort;
  paymentSort: PaymentReportSort;
  filters: {
    q: string;
    page: number;
    dueFrom: string;
    dueTo: string;
    status: string;
    aging: string;
    type: string;
    method: string;
    sort: string;
  };
}

function isExportType(value: string): value is ReportExportType {
  return (EXPORT_TYPES as readonly string[]).includes(value);
}

function exportFilename(type: ReportExportType, today: string): string {
  switch (type) {
    case 'rentals':
      return `laporan-transaksi-rental-${today}.csv`;
    case 'invoices':
      return `laporan-invoice-${today}.csv`;
    case 'payments':
      return `laporan-pembayaran-${today}.csv`;
    case 'receivables':
      return `laporan-piutang-${today}.csv`;
    case 'reminders':
      return `laporan-reminder-${today}.csv`;
  }
}

@Controller('reports')
@UseGuards(TenantAuthGuard)
export class ReportsController {
  constructor(
    private readonly reportService: ReportService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  async index(
    @CurrentAuth() auth: AuthenticationContext,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const tab = readOneOf<ReportTab>(query.tab, REPORT_TABS, 'summary');
    const period = this.resolvePeriod(query);
    const parsed = this.parseFilters(tab, query);
    const filterError = [period.error, parsed.error].filter(Boolean).join(' ') || null;
    let report: unknown = null;

    switch (tab) {
      case 'summary':
        report = await this.reportService.getSummary(auth.businessId, period);
        break;
      case 'rentals':
        report = await this.reportService.getRentals({
          businessId: auth.businessId,
          from: period.fromDate,
          to: period.toDate,
          search: parsed.search,
          status: parsed.rentalStatus,
          sort: parsed.rentalSort,
          page: parsed.page,
          perPage: PER_PAGE,
        });
        break;
      case 'invoices':
        report = await this.reportService.getInvoices(
          {
            businessId: auth.businessId,
            from: period.fromDate,
            to: period.toDate,
            dueFrom: parsed.dueFrom,
            dueTo: parsed.dueTo,
            search: parsed.search,
            status: parsed.invoiceStatus,
            sort: parsed.invoiceSort,
            page: parsed.page,
            perPage: PER_PAGE,
          },
          period,
        );
        break;
      case 'payments':
        report = await this.reportService.getPayments({
          businessId: auth.businessId,
          from: period.fromDate,
          to: period.toDate,
          search: parsed.search,
          method: parsed.paymentMethod,
          status: parsed.paymentStatus,
          sort: parsed.paymentSort,
          page: parsed.page,
          perPage: PER_PAGE,
        });
        break;
      case 'receivables':
        report = await this.reportService.getReceivables({
          businessId: auth.businessId,
          search: parsed.search,
          aging: parsed.aging,
          page: parsed.page,
          perPage: PER_PAGE,
        });
        break;
      case 'reminders':
        report = await this.reportService.getReminders({
          businessId: auth.businessId,
          from: period.fromDate,
          to: period.toDate,
          search: parsed.search,
          type: parsed.reminderType,
          page: parsed.page,
          perPage: PER_PAGE,
        });
        break;
    }

    response.render('reports/index', {
      pageTitle: 'Laporan',
      pageSubtitle: 'Analisis operasional dan keuangan bisnis penyewaan Anda',
      activeNav: 'reports',
      tab,
      tabs: REPORT_TABS,
      tabLabels: REPORT_TAB_LABELS,
      period,
      periodOptions: REPORT_PERIODS,
      periodLabels: REPORT_PERIOD_LABELS,
      filterError,
      report,
      filters: parsed.filters,
    });
  }

  @Get('export/:type')
  async export(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('type') type: string,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    if (!isExportType(type)) {
      throw new NotFoundException('Jenis ekspor laporan tidak ditemukan.');
    }

    const period = this.resolvePeriod(query);
    if (period.error) {
      response.status(400).type('text/plain').send(period.error);
      return;
    }

    const parsed = this.parseFilters(
      type === 'rentals'
        ? 'rentals'
        : type === 'invoices'
          ? 'invoices'
          : type === 'payments'
            ? 'payments'
            : type === 'receivables'
              ? 'receivables'
              : 'reminders',
      query,
    );

    if (parsed.error) {
      response.status(400).type('text/plain').send(parsed.error);
      return;
    }

    const today = todayDateOnly(this.timezone());
    const rows = this.exportRows(type, auth.businessId, period, parsed);

    try {
      await streamCsv(response, {
        filename: exportFilename(type, today),
        header: [...REPORT_CSV_HEADERS[type]],
        rows,
      });
    } catch (error) {
      if (!response.headersSent) {
        throw error;
      }
      response.destroy(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private exportRows(
    type: ReportExportType,
    businessId: string,
    period: ResolvedReportPeriod,
    parsed: ParsedReportFilters,
  ): AsyncGenerator<CsvRow> {
    switch (type) {
      case 'rentals':
        return this.reportService.exportRentals({
          businessId,
          from: period.fromDate,
          to: period.toDate,
          search: parsed.search,
          status: parsed.rentalStatus,
          sort: parsed.rentalSort,
          page: 1,
          perPage: PER_PAGE,
        });
      case 'invoices':
        return this.reportService.exportInvoices({
          businessId,
          from: period.fromDate,
          to: period.toDate,
          dueFrom: parsed.dueFrom,
          dueTo: parsed.dueTo,
          search: parsed.search,
          status: parsed.invoiceStatus,
          sort: parsed.invoiceSort,
          page: 1,
          perPage: PER_PAGE,
        });
      case 'payments':
        return this.reportService.exportPayments({
          businessId,
          from: period.fromDate,
          to: period.toDate,
          search: parsed.search,
          method: parsed.paymentMethod,
          status: parsed.paymentStatus,
          sort: parsed.paymentSort,
          page: 1,
          perPage: PER_PAGE,
        });
      case 'receivables':
        return this.reportService.exportReceivables({
          businessId,
          search: parsed.search,
          aging: parsed.aging,
          page: 1,
          perPage: PER_PAGE,
        });
      case 'reminders':
        return this.reportService.exportReminders({
          businessId,
          from: period.fromDate,
          to: period.toDate,
          search: parsed.search,
          type: parsed.reminderType,
          page: 1,
          perPage: PER_PAGE,
        });
    }
  }

  private resolvePeriod(query: Record<string, unknown>): ResolvedReportPeriod {
    return resolveReportPeriod(
      {
        period: readString(query.period),
        from: readString(query.from),
        to: readString(query.to),
      },
      todayDateOnly(this.timezone()),
    );
  }

  private parseFilters(tab: ReportTab, query: Record<string, unknown>): ParsedReportFilters {
    const search = readString(query.q);
    const page = readPage(query.page);
    const statusText = readString(query.status);
    const methodText = readString(query.method);
    const agingText = readString(query.aging);
    const reminderTypeText = readString(query.type);
    const dueFromText = readString(query.dueFrom);
    const dueToText = readString(query.dueTo);
    const dueFrom = parseDateOnly(dueFromText);
    const dueTo = parseDateOnly(dueToText);
    let error = '';

    if ((dueFromText && !dueFrom) || (dueToText && !dueTo)) {
      error = 'Tanggal jatuh tempo tidak valid.';
    } else if (dueFrom && dueTo && dueTo.getTime() < dueFrom.getTime()) {
      error = 'Tanggal jatuh tempo akhir tidak boleh sebelum tanggal awal.';
    }

    const rentalStatus: RentalStatus | null = isRentalStatus(statusText) ? statusText : null;
    const invoiceStatus: InvoiceStatus | null = isInvoiceStatus(statusText) ? statusText : null;
    const paymentMethod: PaymentMethod | null = isPaymentMethod(methodText) ? methodText : null;
    const paymentStatus: 'valid' | 'void' | null =
      statusText === 'valid' || statusText === 'void' ? statusText : null;
    const aging: ReceivableGroupKey | null = isReceivableGroup(agingText) ? agingText : null;
    const reminderType: ReminderType | null = isReminderType(reminderTypeText)
      ? reminderTypeText
      : null;
    const rentalSort = readOneOf<RentalReportSort>(query.sort, RENTAL_REPORT_SORTS, 'start_desc');
    const invoiceSort = readOneOf<InvoiceReportSort>(
      query.sort,
      INVOICE_REPORT_SORTS,
      'issue_desc',
    );
    const paymentSort = readOneOf<PaymentReportSort>(query.sort, PAYMENT_REPORT_SORTS, 'date_desc');

    return {
      search,
      page,
      error,
      dueFrom: error ? null : dueFrom,
      dueTo: error ? null : dueTo,
      rentalStatus,
      invoiceStatus,
      paymentMethod,
      paymentStatus,
      aging,
      reminderType,
      rentalSort,
      invoiceSort,
      paymentSort,
      filters: {
        q: search,
        page,
        dueFrom: dueFromText,
        dueTo: dueToText,
        status:
          tab === 'rentals'
            ? (rentalStatus ?? '')
            : tab === 'invoices'
              ? (invoiceStatus ?? '')
              : tab === 'payments'
                ? (paymentStatus ?? '')
                : '',
        aging: aging ?? '',
        type: reminderType ?? '',
        method: paymentMethod ?? '',
        sort:
          tab === 'rentals'
            ? rentalSort
            : tab === 'invoices'
              ? invoiceSort
              : tab === 'payments'
                ? paymentSort
                : '',
      },
    };
  }

  private timezone(): string {
    return this.configService.get<string>('app.timezone') ?? 'Asia/Jakarta';
  }
}
