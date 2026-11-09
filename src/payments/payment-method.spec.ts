import { PAYMENT_METHODS, PAYMENT_METHOD_LABELS, isPaymentMethod } from './payment-method.js';

describe('payment method', () => {
  it('mengenali metode pembayaran yang didukung', () => {
    expect(PAYMENT_METHODS).toEqual(['CASH', 'BANK_TRANSFER', 'E_WALLET', 'OTHER']);
    expect(isPaymentMethod('CASH')).toBe(true);
    expect(isPaymentMethod('BANK_TRANSFER')).toBe(true);
    expect(isPaymentMethod('QRIS')).toBe(false);
  });

  it('menyediakan label bahasa Indonesia', () => {
    expect(PAYMENT_METHOD_LABELS.CASH).toBe('Tunai');
    expect(PAYMENT_METHOD_LABELS.BANK_TRANSFER).toBe('Transfer Bank');
    expect(PAYMENT_METHOD_LABELS.E_WALLET).toBe('E-Wallet');
    expect(PAYMENT_METHOD_LABELS.OTHER).toBe('Lainnya');
  });
});
