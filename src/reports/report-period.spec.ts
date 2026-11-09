import {
  daysInclusive,
  monthEndDateOnly,
  monthStartDateOnly,
  resolveReportPeriod,
  shiftMonthDateOnly,
} from './report-period.js';

const today = '2026-11-15';

describe('Report period', () => {
  it('menggunakan bulan berjalan sebagai default', () => {
    const period = resolveReportPeriod({}, today);

    expect(period.period).toBe('this_month');
    expect(period.from).toBe('2026-11-01');
    expect(period.to).toBe('2026-11-15');
    expect(period.error).toBeNull();
  });

  it('menghitung periode hari ini, 7 hari, 30 hari, dan tahun ini secara inklusif', () => {
    expect(resolveReportPeriod({ period: 'today' }, today)).toMatchObject({
      from: '2026-11-15',
      to: '2026-11-15',
    });
    expect(resolveReportPeriod({ period: 'last_7_days' }, today)).toMatchObject({
      from: '2026-11-09',
      to: '2026-11-15',
    });
    expect(resolveReportPeriod({ period: 'last_30_days' }, today)).toMatchObject({
      from: '2026-10-17',
      to: '2026-11-15',
    });
    expect(resolveReportPeriod({ period: 'this_year' }, today)).toMatchObject({
      from: '2026-01-01',
      to: '2026-11-15',
    });
  });

  it('menghitung bulan sebelumnya dan bulan berjalan', () => {
    expect(resolveReportPeriod({ period: 'last_month' }, today)).toMatchObject({
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(resolveReportPeriod({ period: 'last_month' }, '2026-01-20')).toMatchObject({
      from: '2025-12-01',
      to: '2025-12-31',
    });
    expect(resolveReportPeriod({ period: 'this_month' }, '2026-02-10')).toMatchObject({
      from: '2026-02-01',
      to: '2026-02-10',
    });
  });

  it('menerima rentang custom dan menghitung periode pembanding dengan panjang sama', () => {
    const period = resolveReportPeriod(
      { period: 'custom', from: '2026-11-10', to: '2026-11-12' },
      today,
    );

    expect(period).toMatchObject({
      period: 'custom',
      from: '2026-11-10',
      to: '2026-11-12',
      previousFrom: '2026-11-07',
      previousTo: '2026-11-09',
    });
  });

  it('menolak custom yang tidak lengkap atau terbalik', () => {
    const missing = resolveReportPeriod({ period: 'custom', from: '2026-11-10' }, today);
    expect(missing.period).toBe('this_month');
    expect(missing.error).toContain('tidak valid');

    const reversed = resolveReportPeriod(
      { period: 'custom', from: '2026-11-15', to: '2026-11-01' },
      today,
    );
    expect(reversed.period).toBe('this_month');
    expect(reversed.error).toContain('tidak boleh sebelum');
  });

  it('menghitung helper tanggal bulan dan jumlah hari', () => {
    expect(monthStartDateOnly('2026-11-15')).toBe('2026-11-01');
    expect(monthEndDateOnly('2026-11-15')).toBe('2026-11-30');
    expect(monthEndDateOnly('2026-02-10')).toBe('2026-02-28');
    expect(shiftMonthDateOnly('2026-11-15', -1)).toBe('2026-10-01');
    expect(shiftMonthDateOnly('2026-01-15', -1)).toBe('2025-12-01');
    expect(daysInclusive('2026-11-01', '2026-11-15')).toBe(15);
    expect(daysInclusive('2026-11-15', '2026-11-15')).toBe(1);
  });
});
