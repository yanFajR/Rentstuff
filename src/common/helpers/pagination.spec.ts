import { buildPagination } from './pagination.js';

describe('buildPagination', () => {
  it('menangani data kosong', () => {
    expect(buildPagination(1, 0, 10)).toEqual({
      page: 1,
      perPage: 10,
      total: 0,
      totalPages: 1,
      from: 0,
      to: 0,
    });
  });

  it('menghitung rentang data pada halaman kedua', () => {
    expect(buildPagination(2, 25, 10)).toEqual({
      page: 2,
      perPage: 10,
      total: 25,
      totalPages: 3,
      from: 11,
      to: 20,
    });
  });

  it('membatasi halaman ke halaman terakhir', () => {
    expect(buildPagination(99, 25, 10)).toMatchObject({
      page: 3,
      from: 21,
      to: 25,
    });
  });

  it('membatasi halaman minimal satu', () => {
    expect(buildPagination(0, 25, 10).page).toBe(1);
  });

  it('menangani perPage tidak valid', () => {
    expect(buildPagination(1, 5, 0).perPage).toBe(1);
  });
});
