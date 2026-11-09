import { buildUrl } from './url.js';

describe('buildUrl', () => {
  it('mengembalikan path tanpa query jika parameter kosong', () => {
    expect(buildUrl('/customers')).toBe('/customers');
    expect(buildUrl('/customers', { q: '', page: undefined, sort: null })).toBe('/customers');
  });

  it('menyusun query string dan meng-encode nilai', () => {
    expect(buildUrl('/customers', { q: 'Budi Santoso', page: 2 })).toBe(
      '/customers?q=Budi+Santoso&page=2',
    );
  });

  it('menggabungkan filter dan halaman', () => {
    const url = buildUrl('/rentals', {
      q: 'RNT',
      status: 'ACTIVE',
      from: '2026-11-01',
      page: 3,
    });

    expect(url).toBe('/rentals?q=RNT&status=ACTIVE&from=2026-11-01&page=3');
  });
});
