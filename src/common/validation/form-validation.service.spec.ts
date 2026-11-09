import { FormValidationService } from './form-validation.service.js';
import { RegisterDto } from '../../auth/dto/register.dto.js';
import { UpdateBusinessDto } from '../../businesses/dto/update-business.dto.js';

describe('FormValidationService', () => {
  const service = new FormValidationService();

  it('menerima input register yang valid dan menormalkan email', async () => {
    const result = await service.validate(RegisterDto, {
      _csrf: 'token-dari-form',
      name: '  Budi Santoso  ',
      email: '  Budi.Santoso@Example.COM ',
      password: 'Rahasia123',
      confirmPassword: 'Rahasia123',
      businessName: '  Rental Maju  ',
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual({});
    expect(result.data.email).toBe('budi.santoso@example.com');
    expect(result.data.name).toBe('Budi Santoso');
    expect(result.data.businessName).toBe('Rental Maju');
    expect((result.data as unknown as Record<string, unknown>)._csrf).toBeUndefined();
  });

  it('menolak register dengan pesan bahasa Indonesia', async () => {
    const result = await service.validate(RegisterDto, {
      name: '',
      email: 'bukan-email',
      password: 'pendek',
      confirmPassword: 'beda',
      businessName: '',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.name).toContain('Nama lengkap');
    expect(result.errors.email).toContain('Format email');
    expect(result.errors.password).toContain('Kata sandi');
    expect(result.errors.businessName).toContain('Nama bisnis');
  });

  it('menolak kata sandi tanpa angka atau tanpa huruf', async () => {
    const noNumber = await service.validate(RegisterDto, {
      name: 'Budi',
      email: 'budi@example.com',
      password: 'hanyahuruf',
      confirmPassword: 'hanyahuruf',
      businessName: 'Rental',
    });
    expect(noNumber.errors.password).toContain('angka');

    const noLetter = await service.validate(RegisterDto, {
      name: 'Budi',
      email: 'budi@example.com',
      password: '12345678',
      confirmPassword: '12345678',
      businessName: 'Rental',
    });
    expect(noLetter.errors.password).toContain('huruf');
  });

  it('memvalidasi nomor WhatsApp dan mengabaikan field asing', async () => {
    const result = await service.validate(UpdateBusinessDto, {
      _csrf: 'token',
      businessId: 'business-lain',
      businessName: 'Rental Maju',
      ownerName: 'Budi',
      whatsappNumber: '0812-3456-7890',
      address: 'Jl. Merdeka 1',
      description: '',
    });

    expect(result.valid).toBe(true);
    expect(result.data.whatsappNumber).toBe('081234567890');
    expect((result.data as unknown as Record<string, unknown>).businessId).toBeUndefined();
  });

  it('menolak nomor WhatsApp yang tidak valid', async () => {
    const result = await service.validate(UpdateBusinessDto, {
      businessName: 'Rental Maju',
      ownerName: 'Budi',
      whatsappNumber: '12345',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.whatsappNumber).toContain('Nomor WhatsApp');
  });

  it('mengizinkan nomor WhatsApp dan deskripsi kosong', async () => {
    const result = await service.validate(UpdateBusinessDto, {
      businessName: 'Rental Maju',
      ownerName: 'Budi',
      whatsappNumber: '',
      address: '',
      description: '',
    });

    expect(result.valid).toBe(true);
    expect(result.data.whatsappNumber).toBeUndefined();
  });
});
