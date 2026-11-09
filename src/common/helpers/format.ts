export const DEFAULT_TIMEZONE = 'Asia/Jakarta';

const rupiahFormatter = new Intl.NumberFormat('id-ID', {
  maximumFractionDigits: 0,
});

const numberFormatter = new Intl.NumberFormat('id-ID');

const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatters = new Map<string, Intl.DateTimeFormat>();

function toDate(value: Date | string): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new RangeError(`Nilai tanggal tidak valid: ${String(value)}`);
  }
  return date;
}

function getDateFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateFormatters.get(timeZone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    timeZone,
  });
  dateFormatters.set(timeZone, formatter);
  return formatter;
}

function getDateTimeFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = dateTimeFormatters.get(timeZone);
  if (cached) {
    return cached;
  }
  const formatter = new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  });
  dateTimeFormatters.set(timeZone, formatter);
  return formatter;
}

export function formatRupiah(amount: number): string {
  const formatted = rupiahFormatter.format(amount);
  return formatted.startsWith('-') ? `-Rp${formatted.slice(1)}` : `Rp${formatted}`;
}

export function formatNumber(value: number): string {
  return numberFormatter.format(value);
}

export function formatDate(value: Date | string, timeZone = DEFAULT_TIMEZONE): string {
  return getDateFormatter(timeZone).format(toDate(value));
}

export function formatDateTime(value: Date | string, timeZone = DEFAULT_TIMEZONE): string {
  return getDateTimeFormatter(timeZone).format(toDate(value));
}

export function formatUptime(totalSeconds: number): string {
  const seconds = Number.isFinite(totalSeconds) ? Math.max(0, Math.floor(totalSeconds)) : 0;
  const units = [
    { label: 'hari', secondsInUnit: 86_400 },
    { label: 'jam', secondsInUnit: 3_600 },
    { label: 'menit', secondsInUnit: 60 },
    { label: 'detik', secondsInUnit: 1 },
  ];

  const parts: string[] = [];
  let remaining = seconds;

  for (const unit of units) {
    if (remaining < unit.secondsInUnit) {
      continue;
    }
    const amount = Math.floor(remaining / unit.secondsInUnit);
    remaining -= amount * unit.secondsInUnit;
    parts.push(`${amount} ${unit.label}`);
    if (parts.length === 2) {
      break;
    }
  }

  return parts.length > 0 ? parts.join(' ') : '0 detik';
}
