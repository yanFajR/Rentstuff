import { jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { PrismaService } from '../common/prisma/prisma.service.js';
import type { CustomerService } from '../customers/customer.service.js';
import { CustomerNotAvailableError, RentalService } from './rental.service.js';

type AnyFunction = (...args: any[]) => any;

const prismaMock = {
  $transaction: jest.fn<AnyFunction>(),
  rentalRecord: {
    findMany: jest.fn<AnyFunction>(),
    count: jest.fn<AnyFunction>(),
    findFirst: jest.fn<AnyFunction>(),
    update: jest.fn<AnyFunction>(),
  },
};

const customerMock = {
  findActiveById: jest.fn<AnyFunction>(),
};

function uniqueError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const baseInput = {
  customerId: 'customer-1',
  itemName: '  Toyota Avanza  ',
  startDate: new Date('2026-11-08T00:00:00.000Z'),
  endDate: new Date('2026-11-10T00:00:00.000Z'),
  price: 1_500_000,
  notes: '  Termasuk sopir  ',
};

function createTransactionMock(sequence = 2, customerFound = true) {
  return {
    customer: {
      findFirst: jest.fn(async () => (customerFound ? { id: 'customer-1' } : null)),
    },
    rentalRecord: {
      count: jest.fn(async () => sequence),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'rental-1',
        ...data,
      })),
    },
  };
}

describe('RentalService', () => {
  let service: RentalService;

  beforeEach(() => {
    service = new RentalService(
      prismaMock as unknown as PrismaService,
      customerMock as unknown as CustomerService,
    );
  });

  describe('list', () => {
    it('membatasi query pada businessId dan menerapkan filter', async () => {
      prismaMock.rentalRecord.count.mockResolvedValue(1);
      prismaMock.rentalRecord.findMany.mockResolvedValue([]);

      await service.list({
        businessId: 'business-1',
        search: 'RNT',
        status: 'ACTIVE',
        from: new Date('2026-11-01T00:00:00.000Z'),
        to: new Date('2026-11-30T00:00:00.000Z'),
        sort: 'start_asc',
        page: 1,
        perPage: 10,
      });

      expect(prismaMock.rentalRecord.count).toHaveBeenCalledWith({
        where: expect.objectContaining({
          businessId: 'business-1',
          status: 'ACTIVE',
          startDate: {
            gte: new Date('2026-11-01T00:00:00.000Z'),
            lte: new Date('2026-11-30T00:00:00.000Z'),
          },
        }),
      });
      expect(prismaMock.rentalRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { startDate: 'asc' },
          skip: 0,
          take: 10,
        }),
      );
    });

    it('tidak menambahkan filter status atau tanggal jika kosong', async () => {
      prismaMock.rentalRecord.count.mockResolvedValue(0);
      prismaMock.rentalRecord.findMany.mockResolvedValue([]);

      await service.list({
        businessId: 'business-1',
        search: '',
        status: null,
        from: null,
        to: null,
        sort: 'created_desc',
        page: 1,
        perPage: 10,
      });

      expect(prismaMock.rentalRecord.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { businessId: 'business-1' },
          orderBy: { createdAt: 'desc' },
        }),
      );
    });
  });

  describe('create', () => {
    it('membuat transaksi ACTIVE dengan nomor otomatis dalam satu transaction', async () => {
      const transaction = createTransactionMock(2);
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(transaction),
      );

      const result = await service.create('business-1', baseInput);

      expect(result).toMatchObject({ id: 'rental-1', rentalNumber: 'RNT-00003' });
      expect(transaction.customer.findFirst).toHaveBeenCalledWith({
        where: { id: 'customer-1', businessId: 'business-1', archivedAt: null },
        select: { id: true },
      });
      expect(transaction.rentalRecord.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          businessId: 'business-1',
          customerId: 'customer-1',
          rentalNumber: 'RNT-00003',
          itemName: 'Toyota Avanza',
          price: 1_500_000,
          notes: 'Termasuk sopir',
          status: 'ACTIVE',
        }),
      });
    });

    it('menolak pelanggan dari bisnis lain atau yang diarsipkan', async () => {
      const transaction = createTransactionMock(2, false);
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(transaction),
      );

      await expect(service.create('business-1', baseInput)).rejects.toBeInstanceOf(
        CustomerNotAvailableError,
      );
    });

    it('mencoba ulang saat terjadi benturan nomor transaksi', async () => {
      const transaction = createTransactionMock(1);
      prismaMock.$transaction
        .mockRejectedValueOnce(uniqueError())
        .mockImplementationOnce(async (callback: AnyFunction) => callback(transaction));

      const result = await service.create('business-1', baseInput);

      expect(result).toMatchObject({ rentalNumber: 'RNT-00002' });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    });

    it('berhenti setelah batas percobaan nomor transaksi', async () => {
      prismaMock.$transaction.mockRejectedValue(uniqueError());

      await expect(service.create('business-1', baseInput)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(5);
    });
  });

  describe('update', () => {
    it('menolak perubahan pada transaksi yang tidak aktif', async () => {
      prismaMock.rentalRecord.findFirst.mockResolvedValue({
        id: 'rental-1',
        status: 'COMPLETED',
      });

      await expect(service.update('business-1', 'rental-1', baseInput)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(prismaMock.rentalRecord.update).not.toHaveBeenCalled();
    });

    it('memperbarui transaksi aktif dengan scoping businessId', async () => {
      prismaMock.rentalRecord.findFirst.mockResolvedValue({
        id: 'rental-1',
        status: 'ACTIVE',
      });
      customerMock.findActiveById.mockResolvedValue({ id: 'customer-1' });

      await service.update('business-1', 'rental-1', baseInput);

      expect(customerMock.findActiveById).toHaveBeenCalledWith('business-1', 'customer-1');
      expect(prismaMock.rentalRecord.update).toHaveBeenCalledWith({
        where: { id: 'rental-1' },
        data: expect.objectContaining({
          customerId: 'customer-1',
          itemName: 'Toyota Avanza',
          price: 1_500_000,
        }),
      });
    });

    it('menolak pelanggan yang tidak aktif saat edit', async () => {
      prismaMock.rentalRecord.findFirst.mockResolvedValue({
        id: 'rental-1',
        status: 'ACTIVE',
      });
      customerMock.findActiveById.mockResolvedValue(null);

      await expect(service.update('business-1', 'rental-1', baseInput)).rejects.toBeInstanceOf(
        CustomerNotAvailableError,
      );
    });
  });

  describe('changeStatus', () => {
    it('menandai transaksi aktif sebagai selesai', async () => {
      prismaMock.rentalRecord.findFirst.mockResolvedValue({
        id: 'rental-1',
        status: 'ACTIVE',
      });

      await service.changeStatus('business-1', 'rental-1', 'COMPLETED');

      expect(prismaMock.rentalRecord.update).toHaveBeenCalledWith({
        where: { id: 'rental-1' },
        data: { status: 'COMPLETED' },
      });
    });

    it('menolak transisi yang tidak valid', async () => {
      prismaMock.rentalRecord.findFirst.mockResolvedValue({
        id: 'rental-1',
        status: 'COMPLETED',
      });

      await expect(
        service.changeStatus('business-1', 'rental-1', 'CANCELLED'),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prismaMock.rentalRecord.update).not.toHaveBeenCalled();
    });
  });

  it('melempar NotFound untuk transaksi tenant lain', async () => {
    prismaMock.rentalRecord.findFirst.mockResolvedValue(null);

    await expect(service.getById('business-1', 'rental-b')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
