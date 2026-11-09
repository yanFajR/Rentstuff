import { dateOnlyInTimezone, parseDateOnly, todayDateOnly } from './date-only.js';

describe('parseDateOnly', () => {
  it('mengubah tanggal YYYY-MM-DD menjadi Date UTC', () => {
    const date = parseDateOnly('2026-11-08');

    expect(date).not.toBeNull();
    expect(date?.toISOString()).toBe('2026-11-08T00:00:00.000Z');
  });

  it('menolak format tanggal yang salah', () => {
    expect(parseDateOnly('2026-1-1')).toBeNull();
    expect(parseDateOnly('08/11/2026')).toBeNull();
    expect(parseDateOnly('')).toBeNull();
  });

  it('menolak tanggal yang tidak ada di kalender', () => {
    expect(parseDateOnly('2026-02-31')).toBeNull();
    expect(parseDateOnly('2026-13-01')).toBeNull();
  });
});

describe('dateOnlyInTimezone', () => {
  it('mengonversi timestamp UTC ke tanggal Asia/Jakarta', () => {
    expect(dateOnlyInTimezone(new Date('2026-11-07T17:30:00.000Z'), 'Asia/Jakarta')).toBe(
      '2026-11-08',
    );
  });

  it('mempertahankan tanggal yang sama pada tengah malam UTC', () => {
    expect(dateOnlyInTimezone(new Date('2026-11-08T00:00:00.000Z'), 'Asia/Jakarta')).toBe(
      '2026-11-08',
    );
  });
});

describe('todayDateOnly', () => {
  it('mengembalikan format YYYY-MM-DD', () => {
    expect(todayDateOnly()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
