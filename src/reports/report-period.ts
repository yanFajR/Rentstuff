import { formatDate } from '../common/helpers/format.js';
import { addDaysToDateOnly, parseDateOnly, todayDateOnly } from '../common/helpers/date-only.js';

export const REPORT_PERIODS = [
  'today',
  'last_7_days',
  'last_30_days',
  'this_month',
  'last_month',
  'this_year',
  'custom',
] as const;

export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export const REPORT_PERIOD_LABELS: Record<ReportPeriod, string> = {
  today: 'Hari ini',
  last_7_days: '7 hari terakhir',
  last_30_days: '30 hari terakhir',
  this_month: 'Bulan ini',
  last_month: 'Bulan sebelumnya',
  this_year: 'Tahun ini',
  custom: 'Rentang tanggal khusus',
};

export interface ResolvedReportPeriod {
  period: ReportPeriod;
  from: string;
  to: string;
  fromDate: Date;
  toDate: Date;
  label: string;
  previousFrom: string;
  previousTo: string;
  previousFromDate: Date;
  previousToDate: Date;
  error: string | null;
}

export function isReportPeriod(value: unknown): value is ReportPeriod {
  return typeof value === 'string' && (REPORT_PERIODS as readonly string[]).includes(value);
}

export function monthStartDateOnly(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

export function monthEndDateOnly(value: string): string {
  const [yearText, monthText] = value.slice(0, 7).split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const date = new Date(Date.UTC(year, month, 0));
  return date.toISOString().slice(0, 10);
}

export function shiftMonthDateOnly(value: string, delta: number): string {
  const [yearText, monthText] = value.slice(0, 7).split('-');
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + delta, 1));
  return date.toISOString().slice(0, 10);
}

export function daysInclusive(from: string, to: string): number {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (!start || !end) {
    return 0;
  }
  return Math.floor((end.getTime() - start.getTime()) / 86_400_000) + 1;
}

function periodRange(period: ReportPeriod, today: string): { from: string; to: string } {
  switch (period) {
    case 'today':
      return { from: today, to: today };
    case 'last_7_days':
      return { from: addDaysToDateOnly(today, -6), to: today };
    case 'last_30_days':
      return { from: addDaysToDateOnly(today, -29), to: today };
    case 'last_month': {
      const from = shiftMonthDateOnly(today, -1);
      return { from, to: addDaysToDateOnly(monthStartDateOnly(today), -1) };
    }
    case 'this_year':
      return { from: `${today.slice(0, 4)}-01-01`, to: today };
    case 'this_month':
    case 'custom':
    default:
      return { from: monthStartDateOnly(today), to: today };
  }
}

function buildResolved(
  period: ReportPeriod,
  from: string,
  to: string,
  error: string | null,
): ResolvedReportPeriod {
  const fromDate = parseDateOnly(from) as Date;
  const toDate = parseDateOnly(to) as Date;
  const length = daysInclusive(from, to);
  const previousTo = addDaysToDateOnly(from, -1);
  const previousFrom = addDaysToDateOnly(previousTo, -(Math.max(1, length) - 1));

  return {
    period,
    from,
    to,
    fromDate,
    toDate,
    label: `${formatDate(fromDate)} – ${formatDate(toDate)}`,
    previousFrom,
    previousTo,
    previousFromDate: parseDateOnly(previousFrom) as Date,
    previousToDate: parseDateOnly(previousTo) as Date,
    error,
  };
}

export function resolveReportPeriod(
  input: { period?: string; from?: string; to?: string },
  todayDate: string = todayDateOnly(),
): ResolvedReportPeriod {
  const requested = isReportPeriod(input.period) ? input.period : 'this_month';

  if (requested === 'custom') {
    const from = input.from?.trim() ?? '';
    const to = input.to?.trim() ?? '';

    if (!parseDateOnly(from) || !parseDateOnly(to)) {
      const fallback = periodRange('this_month', todayDate);
      return buildResolved(
        'this_month',
        fallback.from,
        fallback.to,
        'Rentang tanggal khusus tidak valid. Isi tanggal awal dan akhir yang benar.',
      );
    }

    if (to < from) {
      const fallback = periodRange('this_month', todayDate);
      return buildResolved(
        'this_month',
        fallback.from,
        fallback.to,
        'Tanggal akhir tidak boleh sebelum tanggal awal.',
      );
    }

    return buildResolved('custom', from, to, null);
  }

  const range = periodRange(requested, todayDate);
  return buildResolved(requested, range.from, range.to, null);
}
