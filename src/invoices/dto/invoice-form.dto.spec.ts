import { FormValidationService } from '../../common/validation/form-validation.service.js';
import { CancelInvoiceDto, CreateInvoiceDto, UpdateInvoiceDto } from './invoice-form.dto.js';

const RENTAL_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('invoice DTO validation', () => {
  const service = new FormValidationService();

  it('menerima invoice valid dan mengubah total menjadi integer', async () => {
    const result = await service.validate(CreateInvoiceDto, {
      rentalRecordId: RENTAL_ID,
      issueDate: '2026-11-08',
      dueDate: '2026-11-15',
      totalAmount: '1.500.000',
      description: ' Tagihan sewa ',
      notes: '',
    });

    expect(result.valid).toBe(true);
    expect(result.data.totalAmount).toBe(1_500_000);
    expect(result.data.description).toBe('Tagihan sewa');
    expect(result.data.notes).toBeUndefined();
  });

  it('mewajibkan rental dan tanggal yang valid', async () => {
    const result = await service.validate(CreateInvoiceDto, {
      rentalRecordId: '',
      issueDate: '08-11-2026',
      dueDate: '2026-11-15',
      totalAmount: '1000',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.rentalRecordId).toBeDefined();
    expect(result.errors.rentalRecordId).toContain('Penyewaan');
    expect(result.errors.issueDate).toContain('Tanggal penerbitan');
  });

  it('menolak total nol, negatif, dan desimal', async () => {
    const base = {
      rentalRecordId: RENTAL_ID,
      issueDate: '2026-11-08',
      dueDate: '2026-11-15',
    };

    const zero = await service.validate(CreateInvoiceDto, { ...base, totalAmount: '0' });
    expect(zero.valid).toBe(false);
    expect(zero.errors.totalAmount).toContain('harus lebih besar dari nol');

    const negative = await service.validate(CreateInvoiceDto, { ...base, totalAmount: '-500' });
    expect(negative.valid).toBe(false);
    expect(negative.errors.totalAmount).toContain('lebih besar dari nol');

    const decimal = await service.validate(CreateInvoiceDto, { ...base, totalAmount: '12.5' });
    expect(decimal.valid).toBe(false);
    expect(decimal.errors.totalAmount).toBeDefined();
  });

  it('memvalidasi form edit invoice', async () => {
    const result = await service.validate(UpdateInvoiceDto, {
      issueDate: '2026-11-08',
      dueDate: '2026-11-20',
      totalAmount: '2.000.000',
      description: '',
      notes: 'Catatan',
    });

    expect(result.valid).toBe(true);
    expect(result.data.totalAmount).toBe(2_000_000);
  });

  it('mewajibkan alasan pembatalan', async () => {
    const invalid = await service.validate(CancelInvoiceDto, { reason: '' });
    expect(invalid.valid).toBe(false);
    expect(invalid.errors.reason).toContain('wajib diisi');

    const valid = await service.validate(CancelInvoiceDto, { reason: '  Pelanggan membatalkan  ' });
    expect(valid.valid).toBe(true);
    expect(valid.data.reason).toBe('Pelanggan membatalkan');
  });
});
