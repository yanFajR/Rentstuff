import {
  RENTAL_STATUS_CLASSES,
  RENTAL_STATUS_LABELS,
  canTransitionRentalStatus,
  formatRentalNumber,
  isRentalStatus,
} from './rental-status.js';

describe('rental status', () => {
  it('mengenali status yang valid', () => {
    expect(isRentalStatus('ACTIVE')).toBe(true);
    expect(isRentalStatus('COMPLETED')).toBe(true);
    expect(isRentalStatus('CANCELLED')).toBe(true);
    expect(isRentalStatus('PAID')).toBe(false);
    expect(isRentalStatus(null)).toBe(false);
  });

  it('menyediakan label dan kelas badge untuk semua status', () => {
    expect(RENTAL_STATUS_LABELS.ACTIVE).toBe('Aktif');
    expect(RENTAL_STATUS_LABELS.COMPLETED).toBe('Selesai');
    expect(RENTAL_STATUS_LABELS.CANCELLED).toBe('Dibatalkan');
    expect(Object.keys(RENTAL_STATUS_CLASSES)).toEqual(['ACTIVE', 'COMPLETED', 'CANCELLED']);
  });

  it('mengizinkan transisi hanya dari ACTIVE', () => {
    expect(canTransitionRentalStatus('ACTIVE', 'COMPLETED')).toBe(true);
    expect(canTransitionRentalStatus('ACTIVE', 'CANCELLED')).toBe(true);
    expect(canTransitionRentalStatus('ACTIVE', 'ACTIVE')).toBe(false);
    expect(canTransitionRentalStatus('COMPLETED', 'CANCELLED')).toBe(false);
    expect(canTransitionRentalStatus('CANCELLED', 'COMPLETED')).toBe(false);
  });

  it('memformat nomor transaksi dengan lima digit', () => {
    expect(formatRentalNumber(1)).toBe('RNT-00001');
    expect(formatRentalNumber(42)).toBe('RNT-00042');
    expect(formatRentalNumber(123456)).toBe('RNT-123456');
    expect(formatRentalNumber(0)).toBe('RNT-00001');
  });
});
