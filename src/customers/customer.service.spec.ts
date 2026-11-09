import { jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { PrismaService } from '../common/prisma/prisma.service.js';
import { CustomerService } from './customer.service.js';

type AnyFunction = (...args: any[]) => any;

const prismaMock = {
  customer: {
    findMany: jest.fn<AnyFunction>(),
    count: jest.fn<AnyFunction>(),
    findFirst: jest.fn<AnyFunction>(),
    create: jest.fn<AnyFunction>(),
    updateMany: jest.fn<AnyFunction>(),
  },
};

describe('CustomerService', () => {
  let service: CustomerService;

  beforeEach(() => {
    service = new CustomerService(prismaMock as unknown as PrismaService);
  });

  describe('list', () => {
    it('membatasi query pada businessId dan memakai pagination default', async () => {
      prismaMock.customer.count.mockResolvedValue(12);
      prismaMock.customer.findMany.mockResolvedValue([]);

      const result = await service.list({
        businessId: 'business-1',
        search: '',
        sort: 'created_desc',
        page: 1,
        perPage: 10,
      });

      expect(prismaMock.customer.count).toHaveBeenCalledWith({
        where: { businessId: 'business-1' },
      });
      expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { businessId: 'business-1' },
          orderBy: { createdAt: 'desc' },
          skip: 0,
          take: 10,
          include: { _count: { select: { rentals: true } } },
        }),
      );
      expect(result.pagination).toMatchObject({
        page: 1,
        total: 12,
        totalPages: 2,
        from: 1,
        to: 10,
      });
    });

    it('mencari nama dan nomor WhatsApp dengan normalisasi', async () => {
      prismaMock.customer.count.mockResolvedValue(12);
      prismaMock.customer.findMany.mockResolvedValue([]);

      await service.list({
        businessId: 'business-1',
        search: '081234567890',
        sort: 'name_asc',
        page: 2,
        perPage: 10,
      });

      const call = prismaMock.customer.findMany.mock.calls[0] as [
        { where: { OR: unknown[] }; skip: number; orderBy: unknown },
      ];

      expect(call[0].skip).toBe(10);
      expect(call[0].orderBy).toEqual({ name: 'asc' });
      expect(call[0].where.OR).toEqual(
        expect.arrayContaining([
          { name: { contains: '081234567890' } },
          { whatsappNumber: { contains: '081234567890' } },
          { whatsappNumber: { contains: '6281234567890' } },
        ]),
      );
    });
  });

  describe('create', () => {
    it('menormalkan nomor WhatsApp, email, dan teks opsional', async () => {
      prismaMock.customer.create.mockResolvedValue({ id: 'customer-1' });

      await service.create('business-1', {
        name: '  Budi Santoso  ',
        whatsappNumber: '0812-3456-7890',
        email: '  Budi.Santoso@Example.COM ',
        address: '   ',
        notes: '  Catatan  ',
      });

      expect(prismaMock.customer.create).toHaveBeenCalledWith({
        data: {
          businessId: 'business-1',
          name: 'Budi Santoso',
          whatsappNumber: '6281234567890',
          email: 'budi.santoso@example.com',
          address: null,
          notes: 'Catatan',
        },
      });
    });

    it('menolak nomor WhatsApp yang tidak valid', async () => {
      await expect(
        service.create('business-1', {
          name: 'Budi',
          whatsappNumber: '12345',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update dan arsip', () => {
    it('memakai kondisi id dan businessId saat update', async () => {
      prismaMock.customer.updateMany.mockResolvedValue({ count: 1 });

      await service.update('business-1', 'customer-1', {
        name: 'Nama Baru',
        whatsappNumber: '081234567890',
        email: '',
        address: 'Jl. Baru',
        notes: '',
      });

      expect(prismaMock.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'customer-1', businessId: 'business-1' },
        data: expect.objectContaining({
          name: 'Nama Baru',
          whatsappNumber: '6281234567890',
          email: null,
          address: 'Jl. Baru',
          notes: null,
        }),
      });
    });

    it('melempar NotFound jika pelanggan bukan milik bisnis', async () => {
      prismaMock.customer.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.update('business-1', 'customer-lain', {
          name: 'Nama',
          whatsappNumber: '081234567890',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('mengarsipkan pelanggan dengan scoping businessId', async () => {
      prismaMock.customer.updateMany.mockResolvedValue({ count: 1 });

      await service.archive('business-1', 'customer-1');

      expect(prismaMock.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'customer-1', businessId: 'business-1' },
        data: { archivedAt: expect.any(Date) },
      });
    });

    it('memulihkan pelanggan dengan scoping businessId', async () => {
      prismaMock.customer.updateMany.mockResolvedValue({ count: 1 });

      await service.restore('business-1', 'customer-1');

      expect(prismaMock.customer.updateMany).toHaveBeenCalledWith({
        where: { id: 'customer-1', businessId: 'business-1' },
        data: { archivedAt: null },
      });
    });

    it('menolak arsip pelanggan bisnis lain', async () => {
      prismaMock.customer.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.archive('business-1', 'customer-b')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('getById', () => {
    it('membatasi detail pada businessId aktif', async () => {
      prismaMock.customer.findFirst.mockResolvedValue({ id: 'customer-1' });

      await service.getById('business-1', 'customer-1');

      expect(prismaMock.customer.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'customer-1', businessId: 'business-1' },
        }),
      );
    });

    it('melempar NotFound untuk pelanggan tenant lain', async () => {
      prismaMock.customer.findFirst.mockResolvedValue(null);

      await expect(service.getById('business-1', 'customer-b')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  it('hanya menampilkan pelanggan aktif pada pilihan transaksi', async () => {
    prismaMock.customer.findMany.mockResolvedValue([]);

    await service.getSelectable('business-1');

    expect(prismaMock.customer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'business-1', archivedAt: null },
      }),
    );
  });
});
