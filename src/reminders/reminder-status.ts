import type { ReminderJobStatus } from './reminder-rules.js';

export type ReminderContactStatus = 'PENDING' | 'OPENED' | 'SENT';
export type ReminderTimingCategory = 'UPCOMING' | 'DUE_TODAY' | 'OVERDUE';

export const REMINDER_JOB_STATUS_LABELS: Record<ReminderJobStatus, string> = {
  PENDING: 'Menunggu jadwal',
  READY: 'Siap dihubungi',
  SKIPPED: 'Dilewati',
};

export const REMINDER_JOB_STATUS_CLASSES: Record<ReminderJobStatus, string> = {
  PENDING: 'bg-slate-100 text-slate-600',
  READY: 'bg-brand-50 text-brand-700',
  SKIPPED: 'bg-slate-100 text-slate-400',
};

export const REMINDER_CONTACT_STATUS_LABELS: Record<ReminderContactStatus, string> = {
  PENDING: 'Belum dihubungi',
  OPENED: 'WhatsApp dibuka',
  SENT: 'Ditandai terkirim',
};

export const REMINDER_CONTACT_STATUS_CLASSES: Record<ReminderContactStatus, string> = {
  PENDING: 'bg-amber-50 text-amber-700',
  OPENED: 'bg-sky-50 text-sky-700',
  SENT: 'bg-emerald-50 text-emerald-700',
};

export const REMINDER_TIMING_LABELS: Record<ReminderTimingCategory, string> = {
  UPCOMING: 'Akan jatuh tempo',
  DUE_TODAY: 'Jatuh tempo hari ini',
  OVERDUE: 'Terlambat',
};

export const REMINDER_TIMING_CLASSES: Record<ReminderTimingCategory, string> = {
  UPCOMING: 'bg-slate-100 text-slate-600',
  DUE_TODAY: 'bg-brand-50 text-brand-700',
  OVERDUE: 'bg-rose-50 text-rose-700',
};

export const REMINDER_ACTIVITY_TYPES = [
  'CREATED',
  'SKIPPED',
  'REACTIVATED',
  'WHATSAPP_OPENED',
  'MARKED_SENT',
] as const;

export type ReminderActivityType = (typeof REMINDER_ACTIVITY_TYPES)[number];

export const REMINDER_ACTIVITY_LABELS: Record<ReminderActivityType, string> = {
  CREATED: 'Pengingat dibuat',
  SKIPPED: 'Pengingat dilewati',
  REACTIVATED: 'Pengingat diaktifkan kembali',
  WHATSAPP_OPENED: 'WhatsApp dibuka',
  MARKED_SENT: 'Ditandai sudah dikirim',
};

export const REMINDER_ACTIVITY_CLASSES: Record<ReminderActivityType, string> = {
  CREATED: 'bg-brand-50 text-brand-600',
  SKIPPED: 'bg-slate-100 text-slate-500',
  REACTIVATED: 'bg-emerald-50 text-emerald-600',
  WHATSAPP_OPENED: 'bg-sky-50 text-sky-600',
  MARKED_SENT: 'bg-emerald-50 text-emerald-700',
};

export function deriveContactStatus(
  activities: ReadonlyArray<{ activityType: string }>,
): ReminderContactStatus {
  if (activities.some((activity) => activity.activityType === 'MARKED_SENT')) {
    return 'SENT';
  }
  if (activities.some((activity) => activity.activityType === 'WHATSAPP_OPENED')) {
    return 'OPENED';
  }
  return 'PENDING';
}

export function deriveTimingCategory(
  scheduledDateOnly: string,
  todayDate: string,
): ReminderTimingCategory {
  if (scheduledDateOnly < todayDate) {
    return 'OVERDUE';
  }
  if (scheduledDateOnly === todayDate) {
    return 'DUE_TODAY';
  }
  return 'UPCOMING';
}
