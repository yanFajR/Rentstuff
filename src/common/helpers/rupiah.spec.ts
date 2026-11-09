import { parseRupiahInput } from './rupiah.js';

describe('parseRupiahInput', () => {
  it('mengubah angka polos menjadi number', () => {
    expect(parseRupiahInput('1500000')).toBe(1_500_000);
  });

  it('mendukung pemisah ribuan titik', () => {
    expect(parseRupiahInput('1.500.000')).toBe(1_500_000);
  });

  it('mendukung prefiks Rp dan spasi', () => {
    expect(parseRupiahInput('Rp 2.500.000')).toBe(2_500_000);
    expect(parseRupiahInput('rp2.500.000')).toBe(2_500_000);
  });

  it('mempertahankan nilai negatif untuk divalidasi selanjutnya', () => {
    expect(parseRupiahInput('-500')).toBe(-500);
  });

  it('meneruskan number apa adanya', () => {
    expect(parseRupiahInput(250_000)).toBe(250_000);
  });

  it('menolak format yang bukan nominal bulat', () => {
    expect(parseRupiahInput('12,5')).toBe('12,5');
    expect(parseRupiahInput('1.5')).toBe('1.5');
    expect(parseRupiahInput('abc')).toBe('abc');
    expect(parseRupiahInput('')).toBe('');
  });
});
