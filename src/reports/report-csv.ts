import { once } from 'node:events';
import type { Response } from 'express';

import { DEFAULT_TIMEZONE } from '../common/helpers/format.js';
import { dateOnlyInTimezone } from '../common/helpers/date-only.js';

export type CsvValue = string | number | null | undefined;
export type CsvRow = CsvValue[];
export type CsvRowGenerator = AsyncGenerator<CsvRow>;

function protectFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function quoteCsv(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replaceAll('"', '""')}"`;
  }
  return value;
}

export function csvText(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return '';
  }
  return quoteCsv(protectFormula(value));
}

export function csvNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '';
  }
  return String(value);
}

export function csvDate(
  value: Date | string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return dateOnlyInTimezone(date, timeZone);
}

export function csvDateTime(
  value: Date | string | null | undefined,
  timeZone: string = DEFAULT_TIMEZONE,
): string {
  if (!value) {
    return '';
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }

  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((item) => item.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}:${part('second')}`;
}

export function toCsvCell(value: CsvValue): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'number') {
    return csvNumber(value);
  }
  return csvText(value);
}

export function csvLine(values: CsvValue[]): string {
  return `${values.map((value) => toCsvCell(value)).join(',')}\r\n`;
}

export async function streamCsv(
  response: Response,
  options: {
    filename: string;
    header: string[];
    rows: CsvRowGenerator;
  },
): Promise<void> {
  response.status(200);
  response.setHeader('Content-Type', 'text/csv; charset=utf-8');
  response.setHeader('Content-Disposition', `attachment; filename="${options.filename}"`);
  response.setHeader('Cache-Control', 'no-store');

  response.write('\uFEFF');
  response.write(csvLine(options.header));

  for await (const row of options.rows) {
    if (!response.write(csvLine(row))) {
      await once(response, 'drain');
    }
  }

  response.end();
}
