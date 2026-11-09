import { FormValidationService } from '../../common/validation/form-validation.service.js';
import { RentalFormDto } from './rental-form.dto.js';

const VALID_CUSTOMER_ID = '550e8400-e29b-41d4-a716-446655440000';

describe('RentalFormDto', () => {
  const service = new FormValidationService();

  it('menerima transaksi valid dan mengubah harga menjadi integer', async () => {
    const result = await service.validate(RentalFormDto, {
      _csrf: 'token',
      customerId: VALID_CUSTOMER_ID,
      itemName: '  Toyota Avanza  ',
      startDate: '2026-11-08',
      endDate: '2026-11-10',
      price: '1.500.000',
      notes: '',
    });

    expect(result.valid).toBe(true);
    expect(result.data.itemName).toBe('Toyota Avanza');
    expect(result.data.price).toBe(1_500_000);
    expect(result.data.notes).toBeUndefined();
  });

  it('mewajibkan pelanggan dan barang/jasa', async () => {
    const result = await service.validate(RentalFormDto, {
      customerId: '',
      itemName: '',
      startDate: '2026-11-08',
      endDate: '2026-11-10',
      price: '1000',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.customerId).toBeDefined();
    expect(result.errors.customerId).toContain('Pelanggan');
    expect(result.errors.itemName).toBeDefined();
    expect(result.errors.itemName).toContain('barang atau jasa');
  });

  it('menolak harga negatif dan harga desimal', async () => {
    const negative = await service.validate(RentalFormDto, {
      customerId: VALID_CUSTOMER_ID,
      itemName: 'Kamera',
      startDate: '2026-11-08',
      endDate: '2026-11-10',
      price: '-500',
    });
    expect(negative.errors.price).toContain('tidak boleh negatif');

    const decimal = await service.validate(RentalFormDto, {
      customerId: VALID_CUSTOMER_ID,
      itemName: 'Kamera',
      startDate: '2026-11-08',
      endDate: '2026-11-10',
      price: '12.5',
    });
    expect(decimal.valid).toBe(false);
    expect(decimal.errors.price).toBeDefined();
  });

  it('menolak format tanggal yang salah', async () => {
    const result = await service.validate(RentalFormDto, {
      customerId: VALID_CUSTOMER_ID,
      itemName: 'Kamera',
      startDate: '08-11-2026',
      endDate: '2026-11-10',
      price: '1000',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.startDate).toContain('Tanggal mulai tidak valid');
  });

  it('menolak customerId yang bukan UUID', async () => {
    const result = await service.validate(RentalFormDto, {
      customerId: 'customer-lain',
      itemName: 'Kamera',
      startDate: '2026-11-08',
      endDate: '2026-11-10',
      price: '1000',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.customerId).toContain('tidak valid');
  });
});
