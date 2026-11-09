import { FormValidationService } from '../../common/validation/form-validation.service.js';
import { CustomerFormDto } from './customer-form.dto.js';

describe('CustomerFormDto', () => {
  const service = new FormValidationService();

  it('menerima input pelanggan yang valid', async () => {
    const result = await service.validate(CustomerFormDto, {
      _csrf: 'token',
      name: '  Budi Santoso ',
      whatsappNumber: '0812-3456-7890',
      email: '  Budi@Example.COM ',
      address: 'Jl. Merdeka 1',
      notes: 'Pelanggan langganan',
    });

    expect(result.valid).toBe(true);
    expect(result.data.name).toBe('Budi Santoso');
    expect(result.data.whatsappNumber).toBe('081234567890');
    expect(result.data.email).toBe('budi@example.com');
    expect((result.data as unknown as Record<string, unknown>)._csrf).toBeUndefined();
  });

  it('mewajibkan nama dan nomor WhatsApp', async () => {
    const result = await service.validate(CustomerFormDto, {
      name: '',
      whatsappNumber: '',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.name).toBeDefined();
    expect(result.errors.name).toContain('Nama pelanggan');
    expect(result.errors.whatsappNumber).toBeDefined();
    expect(result.errors.whatsappNumber).toContain('WhatsApp');
  });

  it('menolak nomor WhatsApp dan email yang tidak valid', async () => {
    const result = await service.validate(CustomerFormDto, {
      name: 'Budi',
      whatsappNumber: '12345',
      email: 'bukan-email',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.whatsappNumber).toContain('Nomor WhatsApp tidak valid');
    expect(result.errors.email).toContain('Format email tidak valid');
  });

  it('mengizinkan email, alamat, dan catatan kosong', async () => {
    const result = await service.validate(CustomerFormDto, {
      name: 'Budi',
      whatsappNumber: '6281234567890',
      email: '',
      address: '',
      notes: '',
    });

    expect(result.valid).toBe(true);
    expect(result.data.email).toBeUndefined();
    expect(result.data.address).toBeUndefined();
    expect(result.data.notes).toBeUndefined();
  });
});
