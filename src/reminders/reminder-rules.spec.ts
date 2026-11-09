import {
  planReminders,
  REMINDER_RULES,
  REMINDER_TIMEZONE,
  reminderTargetDate,
} from './reminder-rules.js';

describe('Reminder rules', () => {
  it('menggunakan zona waktu Asia/Jakarta dan empat aturan default', () => {
    expect(REMINDER_TIMEZONE).toBe('Asia/Jakarta');
    expect(REMINDER_RULES.map((rule) => [rule.type, rule.offsetDays])).toEqual([
      ['H_MINUS_3', -3],
      ['H_MINUS_1', -1],
      ['DUE_DATE', 0],
      ['H_PLUS_1', 1],
    ]);
  });

  it('menghitung tanggal target lintas bulan dan tahun', () => {
    expect(reminderTargetDate('2026-12-01', 'H_MINUS_3')).toBe('2026-11-28');
    expect(reminderTargetDate('2027-01-01', 'H_MINUS_1')).toBe('2026-12-31');
    expect(reminderTargetDate('2026-03-01', 'H_PLUS_1')).toBe('2026-03-02');
    expect(reminderTargetDate('2026-02-31', 'H_MINUS_3')).toBeNull();
  });

  it('membuat H-3 siap dan aturan berikutnya menunggu jadwal', () => {
    const plans = planReminders('2026-11-15', '2026-11-12');

    expect(plans).toEqual([
      { type: 'H_MINUS_3', scheduledDate: '2026-11-12', status: 'READY' },
      { type: 'H_MINUS_1', scheduledDate: '2026-11-14', status: 'PENDING' },
      { type: 'DUE_DATE', scheduledDate: '2026-11-15', status: 'PENDING' },
      { type: 'H_PLUS_1', scheduledDate: '2026-11-16', status: 'PENDING' },
    ]);
  });

  it('hanya membuat aturan jatuh tempo dan H+1 pada tanggal jatuh tempo', () => {
    const plans = planReminders('2026-11-15', '2026-11-15');

    expect(plans).toEqual([
      { type: 'DUE_DATE', scheduledDate: '2026-11-15', status: 'READY' },
      { type: 'H_PLUS_1', scheduledDate: '2026-11-16', status: 'PENDING' },
    ]);
  });

  it('membuat H+1 untuk invoice yang jatuh tempo kemarin', () => {
    expect(planReminders('2026-11-14', '2026-11-15')).toEqual([
      { type: 'H_PLUS_1', scheduledDate: '2026-11-15', status: 'READY' },
    ]);
  });

  it('tidak menandai reminder di luar jadwal hari ini sebagai READY', () => {
    const futurePlans = planReminders('2026-11-20', '2026-11-15');

    expect(futurePlans).toHaveLength(4);
    expect(futurePlans.every((plan) => plan.status === 'PENDING')).toBe(true);
    expect(planReminders('2026-11-10', '2026-11-15')).toEqual([]);
  });

  it('menolak tanggal jatuh tempo yang tidak valid', () => {
    expect(planReminders('2026-02-31', '2026-11-15')).toEqual([]);
    expect(planReminders('2026-11-15', 'bukan-tanggal')).toEqual([]);
  });
});
