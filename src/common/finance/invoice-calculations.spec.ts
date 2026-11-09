import {
  aggregateInvoices,
  summarizeInvoice,
  sumValidPayments,
  type InvoiceSnapshot,
} from './invoice-calculations.js';

const TIMEZONE = 'Asia/Jakarta';

function invoice(overrides: Partial<InvoiceSnapshot> = {}): InvoiceSnapshot {
  return {
    totalAmount: 1_500_000,
    dueDate: new Date('2026-11-10T00:00:00.000Z'),
    cancelledAt: null,
    payments: [],
    ...overrides,
  };
}

describe('invoice calculations', () => {
  it('menghitung total pembayaran valid dan mengabaikan yang void', () => {
    const total = sumValidPayments([
      { amount: 500_000, voidedAt: null },
      { amount: 300_000, voidedAt: new Date() },
      { amount: 200_000, voidedAt: null },
    ]);

    expect(total).toBe(700_000);
  });

  it('menghasilkan UNPAID jika belum ada pembayaran dan belum jatuh tempo', () => {
    const summary = summarizeInvoice(invoice(), '2026-11-05', TIMEZONE);

    expect(summary).toEqual({
      totalPaid: 0,
      outstanding: 1_500_000,
      status: 'UNPAID',
      isOverdue: false,
    });
  });

  it('menghasilkan PARTIAL jika pembayaran sebagian dan belum jatuh tempo', () => {
    const summary = summarizeInvoice(
      invoice({ payments: [{ amount: 500_000, voidedAt: null }] }),
      '2026-11-05',
      TIMEZONE,
    );

    expect(summary.status).toBe('PARTIAL');
    expect(summary.totalPaid).toBe(500_000);
    expect(summary.outstanding).toBe(1_000_000);
  });

  it('menghasilkan PAID jika outstanding nol', () => {
    const summary = summarizeInvoice(
      invoice({
        payments: [
          { amount: 1_000_000, voidedAt: null },
          { amount: 500_000, voidedAt: null },
        ],
      }),
      '2026-11-05',
      TIMEZONE,
    );

    expect(summary.status).toBe('PAID');
    expect(summary.outstanding).toBe(0);
  });

  it('menghasilkan OVERDUE jika melewati jatuh tempo dan masih ada sisa', () => {
    const summary = summarizeInvoice(invoice(), '2026-11-11', TIMEZONE);

    expect(summary.status).toBe('OVERDUE');
    expect(summary.isOverdue).toBe(true);
  });

  it('tidak menganggap overdue pada hari jatuh tempo', () => {
    const summary = summarizeInvoice(invoice(), '2026-11-10', TIMEZONE);

    expect(summary.status).toBe('UNPAID');
    expect(summary.isOverdue).toBe(false);
  });

  it('memberi prioritas OVERDUE untuk invoice partial yang terlambat', () => {
    const summary = summarizeInvoice(
      invoice({ payments: [{ amount: 500_000, voidedAt: null }] }),
      '2026-11-11',
      TIMEZONE,
    );

    expect(summary.status).toBe('OVERDUE');
    expect(summary.outstanding).toBe(1_000_000);
    expect(summary.totalPaid).toBe(500_000);
  });

  it('menghitung pembayaran void sebagai tidak valid', () => {
    const summary = summarizeInvoice(
      invoice({
        payments: [
          { amount: 500_000, voidedAt: new Date('2026-11-06T00:00:00Z') },
          { amount: 200_000, voidedAt: null },
        ],
      }),
      '2026-11-07',
      TIMEZONE,
    );

    expect(summary.totalPaid).toBe(200_000);
    expect(summary.outstanding).toBe(1_300_000);
    expect(summary.status).toBe('PARTIAL');
  });

  it('menghasilkan CANCELLED tanpa outstanding piutang', () => {
    const summary = summarizeInvoice(
      invoice({ cancelledAt: new Date('2026-11-06T00:00:00Z') }),
      '2026-11-30',
      TIMEZONE,
    );

    expect(summary).toEqual({
      totalPaid: 0,
      outstanding: 0,
      status: 'CANCELLED',
      isOverdue: false,
    });
  });

  it('mengagregasi hanya invoice non-cancelled', () => {
    const aggregate = aggregateInvoices(
      [
        invoice(),
        invoice({
          totalAmount: 1_000_000,
          payments: [{ amount: 400_000, voidedAt: null }],
        }),
        invoice({
          totalAmount: 2_000_000,
          cancelledAt: new Date('2026-11-06T00:00:00Z'),
        }),
        invoice({
          totalAmount: 500_000,
          payments: [{ amount: 500_000, voidedAt: null }],
        }),
      ],
      '2026-11-11',
      TIMEZONE,
    );

    expect(aggregate).toEqual({
      billedAmount: 3_000_000,
      paidAmount: 900_000,
      outstandingAmount: 2_100_000,
      unpaidCount: 0,
      partialCount: 0,
      overdueCount: 2,
      paidCount: 1,
      cancelledCount: 1,
    });
  });
});
