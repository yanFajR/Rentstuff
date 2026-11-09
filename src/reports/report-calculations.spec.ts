import {
  RECEIVABLE_GROUPS,
  daysLate,
  receivableGroupFor,
  statusLabelForCsv,
  summarizeInvoiceGroup,
  summarizeRentalInvoices,
} from './report-calculations.js';

const timezone = 'Asia/Jakarta';
const today = '2026-11-15';

function invoice(
  overrides: Partial<{
    totalAmount: number;
    dueDate: Date;
    cancelledAt: Date | null;
    payments: Array<{ amount: number; voidedAt: Date | null }>;
  }> = {},
) {
  return {
    totalAmount: 1_000_000,
    dueDate: new Date('2026-11-20T00:00:00.000Z'),
    cancelledAt: null,
    payments: [],
    ...overrides,
  };
}

describe('Report calculations', () => {
  it('menghitung total invoice dan jumlah status tanpa cancelled dalam total', () => {
    const summary = summarizeInvoiceGroup(
      [
        invoice(),
        invoice({ payments: [{ amount: 400_000, voidedAt: null }] }),
        invoice({ payments: [{ amount: 1_000_000, voidedAt: null }] }),
        invoice({ dueDate: new Date('2026-11-10T00:00:00.000Z') }),
        invoice({ cancelledAt: new Date('2026-11-01T00:00:00.000Z') }),
      ],
      today,
      timezone,
    );

    expect(summary).toMatchObject({
      invoiceCount: 5,
      activeInvoiceCount: 4,
      cancelledCount: 1,
      totalIssued: 4_000_000,
      unpaidCount: 1,
      partialCount: 1,
      paidCount: 1,
      overdueCount: 1,
    });
  });

  it('menghitung total rental dari invoice historis dan mengabaikan cancelled', () => {
    const summary = summarizeRentalInvoices([
      invoice({ totalAmount: 1_000_000, payments: [{ amount: 400_000, voidedAt: null }] }),
      invoice({ totalAmount: 500_000, payments: [{ amount: 100_000, voidedAt: new Date() }] }),
      invoice({ totalAmount: 700_000, cancelledAt: new Date() }),
    ]);

    expect(summary).toEqual({
      invoiceCount: 3,
      totalBilled: 1_500_000,
      totalPaid: 400_000,
      outstanding: 1_100_000,
    });
  });

  it('mengelompokkan umur piutang dengan batas yang benar', () => {
    expect(receivableGroupFor('2026-11-16', today)).toEqual({
      key: 'not_due',
      daysLate: 0,
    });
    expect(receivableGroupFor('2026-11-15', today)).toEqual({
      key: 'due_today',
      daysLate: 0,
    });
    expect(receivableGroupFor('2026-11-14', today)).toEqual({
      key: 'overdue_1_7',
      daysLate: 1,
    });
    expect(receivableGroupFor('2026-11-08', today)).toEqual({
      key: 'overdue_1_7',
      daysLate: 7,
    });
    expect(receivableGroupFor('2026-11-07', today)).toEqual({
      key: 'overdue_8_30',
      daysLate: 8,
    });
    expect(receivableGroupFor('2026-10-16', today)).toEqual({
      key: 'overdue_8_30',
      daysLate: 30,
    });
    expect(receivableGroupFor('2026-10-15', today)).toEqual({
      key: 'overdue_30_plus',
      daysLate: 31,
    });
    expect(daysLate('2026-11-20', today)).toBe(0);
    expect(RECEIVABLE_GROUPS).toHaveLength(5);
  });

  it('menyediakan label status Indonesia untuk CSV', () => {
    expect(statusLabelForCsv('UNPAID')).toBe('Belum dibayar');
    expect(statusLabelForCsv('PARTIAL')).toBe('Dibayar sebagian');
    expect(statusLabelForCsv('PAID')).toBe('Lunas');
    expect(statusLabelForCsv('OVERDUE')).toBe('Terlambat');
    expect(statusLabelForCsv('CANCELLED')).toBe('Dibatalkan');
  });
});
