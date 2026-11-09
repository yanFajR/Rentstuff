export const RENTAL_STATUSES = ['ACTIVE', 'COMPLETED', 'CANCELLED'] as const;

export type RentalStatus = (typeof RENTAL_STATUSES)[number];

export const RENTAL_STATUS_LABELS: Record<RentalStatus, string> = {
  ACTIVE: 'Aktif',
  COMPLETED: 'Selesai',
  CANCELLED: 'Dibatalkan',
};

export const RENTAL_STATUS_CLASSES: Record<RentalStatus, string> = {
  ACTIVE: 'bg-brand-50 text-brand-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

export function isRentalStatus(value: unknown): value is RentalStatus {
  return typeof value === 'string' && (RENTAL_STATUSES as readonly string[]).includes(value);
}

export function canTransitionRentalStatus(from: RentalStatus, to: RentalStatus): boolean {
  if (from !== 'ACTIVE') {
    return false;
  }
  return to === 'COMPLETED' || to === 'CANCELLED';
}

export function formatRentalNumber(sequence: number): string {
  return `RNT-${String(Math.max(1, Math.floor(sequence))).padStart(5, '0')}`;
}
