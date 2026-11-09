import { deriveContactStatus, deriveTimingCategory } from './reminder-status.js';

describe('Status pengingat', () => {
  it('mengutamakan status terkirim di atas WhatsApp dibuka', () => {
    expect(
      deriveContactStatus([
        { activityType: 'CREATED' },
        { activityType: 'WHATSAPP_OPENED' },
        { activityType: 'MARKED_SENT' },
      ]),
    ).toBe('SENT');

    expect(
      deriveContactStatus([{ activityType: 'WHATSAPP_OPENED' }, { activityType: 'CREATED' }]),
    ).toBe('OPENED');

    expect(deriveContactStatus([{ activityType: 'CREATED' }])).toBe('PENDING');
    expect(deriveContactStatus([])).toBe('PENDING');
  });

  it('menentukan kategori berdasarkan tanggal jatuh tempo', () => {
    expect(deriveTimingCategory('2026-11-16', '2026-11-15')).toBe('UPCOMING');
    expect(deriveTimingCategory('2026-11-15', '2026-11-15')).toBe('DUE_TODAY');
    expect(deriveTimingCategory('2026-11-14', '2026-11-15')).toBe('OVERDUE');
  });
});
