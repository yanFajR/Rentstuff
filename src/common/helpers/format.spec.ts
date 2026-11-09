import { formatDate, formatDateTime, formatNumber, formatRupiah, formatUptime } from './format.js';

describe('formatRupiah', () => {
  it('memformat nilai nol', () => {
    expect(formatRupiah(0)).toBe('Rp0');
  });

  it('memakai pemisah ribuan dan tanpa desimal', () => {
    expect(formatRupiah(1_250_000)).toBe('Rp1.250.000');
  });

  it('menempatkan tanda minus sebelum simbol mata uang', () => {
    expect(formatRupiah(-5_000)).toBe('-Rp5.000');
  });
});

describe('formatNumber', () => {
  it('memformat angka dengan pemisah ribuan Indonesia', () => {
    expect(formatNumber(1_250_000)).toBe('1.250.000');
  });
});

describe('formatDate', () => {
  it('mengonversi waktu UTC ke tanggal Asia/Jakarta', () => {
    expect(formatDate('2026-11-07T17:30:00.000Z')).toBe('08 November 2026');
  });

  it('menerima objek Date', () => {
    expect(formatDate(new Date('2026-01-01T00:00:00.000Z'))).toBe('01 Januari 2026');
  });

  it('menolak nilai tanggal yang tidak valid', () => {
    expect(() => formatDate('bukan-tanggal')).toThrow(RangeError);
  });
});

describe('formatDateTime', () => {
  it('menampilkan tanggal dan jam dalam zona waktu Jakarta', () => {
    expect(formatDateTime('2026-11-07T17:30:00.000Z')).toContain('08 November 2026');
  });
});

describe('formatUptime', () => {
  it('menampilkan nol detik', () => {
    expect(formatUptime(0)).toBe('0 detik');
  });

  it('menampilkan detik saja untuk durasi singkat', () => {
    expect(formatUptime(59)).toBe('59 detik');
  });

  it('menampilkan dua satuan terbesar', () => {
    expect(formatUptime(61)).toBe('1 menit 1 detik');
    expect(formatUptime(3_661)).toBe('1 jam 1 menit');
    expect(formatUptime(90_061)).toBe('1 hari 1 jam');
  });

  it('menangani nilai tidak valid', () => {
    expect(formatUptime(Number.NaN)).toBe('0 detik');
    expect(formatUptime(-10)).toBe('0 detik');
  });
});
