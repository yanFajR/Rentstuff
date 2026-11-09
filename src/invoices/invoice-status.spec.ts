import {
  INVOICE_STATUSES,
  INVOICE_STATUS_CLASSES,
  INVOICE_STATUS_LABELS,
  formatInvoiceNumber,
  isInvoiceStatus,
} from './invoice-status.js';

describe('invoice status', () => {
  it('mengenali semua status invoice', () => {
    for (const status of INVOICE_STATUSES) {
      expect(isInvoiceStatus(status)).toBe(true);
    }
    expect(isInvoiceStatus('VOID')).toBe(false);
    expect(isInvoiceStatus(null)).toBe(false);
  });

  it('menyediakan label dan kelas badge', () => {
    expect(INVOICE_STATUS_LABELS).toMatchObject({
      UNPAID: 'Belum dibayar',
      PARTIAL: 'Dibayar sebagian',
      PAID: 'Lunas',
      OVERDUE: 'Terlambat',
      CANCELLED: 'Dibatalkan',
    });
    expect(Object.keys(INVOICE_STATUS_CLASSES)).toEqual([
      'UNPAID',
      'PARTIAL',
      'PAID',
      'OVERDUE',
      'CANCELLED',
    ]);
  });

  it('memformat nomor invoice lima digit', () => {
    expect(formatInvoiceNumber(1)).toBe('INV-00001');
    expect(formatInvoiceNumber(42)).toBe('INV-00042');
    expect(formatInvoiceNumber(0)).toBe('INV-00001');
  });
});
