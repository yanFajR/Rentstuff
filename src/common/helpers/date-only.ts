import { DEFAULT_TIMEZONE } from './format.js';

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseDateOnly(value: string): Date | null {
  if (!DATE_ONLY_PATTERN.test(value)) {
    return null;
  }

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10) === value ? date : null;
}

export function dateOnlyInTimezone(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);

  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}`;
}

export function todayDateOnly(timeZone: string = DEFAULT_TIMEZONE): string {
  return dateOnlyInTimezone(new Date(), timeZone);
}

export function addDaysToDateOnly(value: string, days: number): string {
  const date = parseDateOnly(value);
  if (!date) {
    return value;
  }
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
