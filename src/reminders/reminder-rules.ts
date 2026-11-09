import { addDaysToDateOnly, parseDateOnly } from '../common/helpers/date-only.js';

export const REMINDER_TIMEZONE = 'Asia/Jakarta';

export const REMINDER_TYPES = ['H_MINUS_3', 'H_MINUS_1', 'DUE_DATE', 'H_PLUS_1'] as const;
export type ReminderType = (typeof REMINDER_TYPES)[number];

export interface ReminderRule {
  type: ReminderType;
  offsetDays: number;
  label: string;
  description: string;
}

export const REMINDER_RULES: readonly ReminderRule[] = [
  {
    type: 'H_MINUS_3',
    offsetDays: -3,
    label: 'H-3',
    description: '3 hari sebelum jatuh tempo',
  },
  {
    type: 'H_MINUS_1',
    offsetDays: -1,
    label: 'H-1',
    description: '1 hari sebelum jatuh tempo',
  },
  {
    type: 'DUE_DATE',
    offsetDays: 0,
    label: 'Jatuh tempo',
    description: 'Pada tanggal jatuh tempo',
  },
  {
    type: 'H_PLUS_1',
    offsetDays: 1,
    label: 'H+1',
    description: '1 hari setelah jatuh tempo',
  },
];

export const REMINDER_JOB_STATUSES = ['PENDING', 'READY', 'SKIPPED'] as const;
export type ReminderJobStatus = (typeof REMINDER_JOB_STATUSES)[number];

export function isReminderType(value: unknown): value is ReminderType {
  return typeof value === 'string' && (REMINDER_TYPES as readonly string[]).includes(value);
}

export function isReminderJobStatus(value: unknown): value is ReminderJobStatus {
  return typeof value === 'string' && (REMINDER_JOB_STATUSES as readonly string[]).includes(value);
}

export function getReminderRule(type: string): ReminderRule | null {
  return REMINDER_RULES.find((rule) => rule.type === type) ?? null;
}

export function reminderTargetDate(dueDateOnly: string, type: ReminderType): string | null {
  const rule = getReminderRule(type);
  if (!rule || !parseDateOnly(dueDateOnly)) {
    return null;
  }
  return addDaysToDateOnly(dueDateOnly, rule.offsetDays);
}

export interface PlannedReminder {
  type: ReminderType;
  scheduledDate: string;
  status: 'PENDING' | 'READY';
}

export function planReminders(dueDateOnly: string, todayDate: string): PlannedReminder[] {
  if (!parseDateOnly(dueDateOnly) || !parseDateOnly(todayDate)) {
    return [];
  }

  const plans: PlannedReminder[] = [];

  for (const rule of REMINDER_RULES) {
    const target = addDaysToDateOnly(dueDateOnly, rule.offsetDays);
    if (target < todayDate) {
      continue;
    }
    plans.push({
      type: rule.type,
      scheduledDate: target,
      status: target === todayDate ? 'READY' : 'PENDING',
    });
  }

  return plans;
}

export const REMINDER_SKIP_REASONS = {
  PAID: 'Tagihan sudah lunas.',
  CANCELLED: 'Tagihan dibatalkan.',
  DUE_DATE_CHANGED: 'Tanggal jatuh tempo berubah.',
} as const;
