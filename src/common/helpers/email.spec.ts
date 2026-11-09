import { normalizeEmail } from './email.js';

describe('normalizeEmail', () => {
  it('mengubah email menjadi lowercase dan menghapus spasi tepi', () => {
    expect(normalizeEmail('  Budi.Santoso@Example.COM ')).toBe('budi.santoso@example.com');
  });

  it('mempertahankan email yang sudah normal', () => {
    expect(normalizeEmail('admin@rental.id')).toBe('admin@rental.id');
  });
});
