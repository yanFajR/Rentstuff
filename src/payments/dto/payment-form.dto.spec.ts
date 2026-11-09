import { FormValidationService } from '../../common/validation/form-validation.service.js';
import { PaymentFormDto, VoidPaymentDto } from './payment-form.dto.js';

describe('payment DTO validation', () => {
  const service = new FormValidationService();

  it('menerima pembayaran valid', async () => {
    const result = await service.validate(PaymentFormDto, {
      amount: '500.000',
      paymentDate: '2026-11-10',
      method: 'BANK_TRANSFER',
      reference: 'TRX-123',
      notes: 'Transfer BCA',
    });

    expect(result.valid).toBe(true);
    expect(result.data.amount).toBe(500_000);
    expect(result.data.method).toBe('BANK_TRANSFER');
  });

  it('menolak nominal nol, negatif, dan desimal', async () => {
    const base = { paymentDate: '2026-11-10', method: 'CASH' };

    const zero = await service.validate(PaymentFormDto, { ...base, amount: '0' });
    expect(zero.valid).toBe(false);
    expect(zero.errors.amount).toContain('lebih besar dari nol');

    const negative = await service.validate(PaymentFormDto, { ...base, amount: '-500' });
    expect(negative.valid).toBe(false);

    const decimal = await service.validate(PaymentFormDto, { ...base, amount: '12.5' });
    expect(decimal.valid).toBe(false);
    expect(decimal.errors.amount).toBeDefined();
  });

  it('menolak metode dan tanggal yang tidak valid', async () => {
    const result = await service.validate(PaymentFormDto, {
      amount: '1000',
      paymentDate: '10-11-2026',
      method: 'QRIS',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.paymentDate).toContain('Tanggal pembayaran');
    expect(result.errors.method).toContain('Metode pembayaran');
  });

  it('mewajibkan alasan void', async () => {
    const invalid = await service.validate(VoidPaymentDto, { reason: '' });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.reason).toContain('wajib diisi');

    const valid = await service.validate(VoidPaymentDto, { reason: 'Salah input nominal' });
    expect(valid.valid).toBe(true);
  });
});
