import { formatWhatsAppNumber, normalizeWhatsAppNumber } from './whatsapp.js';

describe('normalizeWhatsAppNumber', () => {
  it('menormalkan nomor yang diawali 0 menjadi 62', () => {
    expect(normalizeWhatsAppNumber('0812-3456-7890')).toBe('6281234567890');
  });

  it('mempertahankan nomor yang sudah diawali 62', () => {
    expect(normalizeWhatsAppNumber('6281234567890')).toBe('6281234567890');
  });

  it('menangani format internasional dengan tanda plus dan spasi', () => {
    expect(normalizeWhatsAppNumber('+62 812 3456 7890')).toBe('6281234567890');
  });

  it('menambahkan prefiks 62 untuk nomor tanpa awalan', () => {
    expect(normalizeWhatsAppNumber('81234567890')).toBe('6281234567890');
  });

  it('menolak nomor yang tidak valid', () => {
    expect(normalizeWhatsAppNumber('')).toBeNull();
    expect(normalizeWhatsAppNumber('12345')).toBeNull();
    expect(normalizeWhatsAppNumber('021-123456')).toBeNull();
    expect(normalizeWhatsAppNumber('bukan-nomor')).toBeNull();
  });
});

describe('formatWhatsAppNumber', () => {
  it('menampilkan nomor dalam format internasional', () => {
    expect(formatWhatsAppNumber('081234567890')).toBe('+6281234567890');
  });

  it('mengembalikan nilai asli jika tidak valid', () => {
    expect(formatWhatsAppNumber('bukan-nomor')).toBe('bukan-nomor');
  });
});
