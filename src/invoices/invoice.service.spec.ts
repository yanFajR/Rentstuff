import { jest } from '@jest/globals';
import { NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../common/prisma/prisma.service.js';
import {
  InvoiceLockedError,
  InvoiceService,
  RentalNotInvoiceableError,
} from './invoice.service.js';

type AnyFunction = (...args: any[]) => any;

const reminderSchedulerMock = {
  reconcileInvoice: jest.fn<AnyFunction>(async () => ({
    todayDate: '2026-11-08',
    created: 0,
    promoted: 0,
    skipped: 0,
    reactivated: 0,
    errors: 0,
    alreadyRunning: false,
  })),
};

const prismaMock = {
  $transaction: jest.fn<AnyFunction>(),
  invoice: {
    findFirst: jest.fn<AnyFunction>(),
    findMany: jest.fn<AnyFunction>(),
    count: jest.fn<AnyFunction>(),
  },
  rentalRecord: {
    findFirst: jest.fn<AnyFunction>(),
    findMany: jest.fn<AnyFunction>(),
  },
};

const configMock = {
  get: jest.fn((key: string) => (key === 'app.timezone' ? 'Asia/Jakarta' : undefined)),
};

function uniqueError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

const issueDate = new Date('2026-11-08T00:00:00.000Z');
const dueDate = new Date('2026-11-15T00:00:00.000Z');

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    invoiceNumber: 'INV-00001',
    totalAmount: 1_000_000,
    dueDate,
    cancelledAt: null,
    payments: [],
    rentalRecord: { customer: { id: 'customer-1', name: 'Budi' } },
    ...overrides,
  };
}

describe('InvoiceService', () => {
  let service: InvoiceService;

  beforeEach(() => {
    service = new InvoiceService(
      prismaMock as unknown as PrismaService,
      configMock as unknown as ConfigService,
      reminderSchedulerMock as never,
    );
  });

  describe('create', () => {
    it('membuat invoice snapshot dengan nomor otomatis', async () => {
      const transaction = {
        rentalRecord: {
          findFirst: jest.fn(async () => ({
            id: 'rental-1',
            status: 'ACTIVE',
            customerId: 'customer-1',
          })),
        },
        invoice: {
          count: jest.fn(async () => 2),
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'invoice-1',
            ...data,
          })),
        },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(transaction),
      );

      const created = await service.create('business-1', {
        rentalRecordId: 'rental-1',
        issueDate,
        dueDate,
        totalAmount: 1_500_000,
        description: '  Tagihan sewa  ',
        notes: '',
      });

      expect(created).toMatchObject({ id: 'invoice-1', invoiceNumber: 'INV-00003' });
      expect(transaction.invoice.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          businessId: 'business-1',
          rentalRecordId: 'rental-1',
          invoiceNumber: 'INV-00003',
          issueDate,
          dueDate,
          totalAmount: 1_500_000,
          description: 'Tagihan sewa',
          notes: null,
        }),
      });
    });

    it('menolak rental yang dibatalkan atau bukan milik bisnis', async () => {
      const cancelled = {
        rentalRecord: {
          findFirst: jest.fn(async () => ({
            id: 'rental-1',
            status: 'CANCELLED',
            customerId: 'customer-1',
          })),
        },
        invoice: { count: jest.fn(), create: jest.fn() },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(cancelled),
      );

      await expect(
        service.create('business-1', {
          rentalRecordId: 'rental-1',
          issueDate,
          dueDate,
          totalAmount: 1_000,
        }),
      ).rejects.toBeInstanceOf(RentalNotInvoiceableError);

      const missing = {
        rentalRecord: { findFirst: jest.fn(async () => null) },
        invoice: { count: jest.fn(), create: jest.fn() },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(missing),
      );

      await expect(
        service.create('business-1', {
          rentalRecordId: 'rental-lain',
          issueDate,
          dueDate,
          totalAmount: 1_000,
        }),
      ).rejects.toBeInstanceOf(RentalNotInvoiceableError);
    });

    it('mencoba ulang saat nomor invoice bentrok', async () => {
      const transaction = {
        rentalRecord: {
          findFirst: jest.fn(async () => ({ id: 'rental-1', status: 'ACTIVE', customerId: 'c1' })),
        },
        invoice: {
          count: jest.fn(async () => 0),
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'invoice-1',
            ...data,
          })),
        },
      };
      prismaMock.$transaction
        .mockRejectedValueOnce(uniqueError())
        .mockImplementationOnce(async (callback: AnyFunction) => callback(transaction));

      const created = await service.create('business-1', {
        rentalRecordId: 'rental-1',
        issueDate,
        dueDate,
        totalAmount: 1_000,
      });

      expect(created).toMatchObject({ invoiceNumber: 'INV-00001' });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(2);
    });
  });

  describe('update dan cancel', () => {
    it('menolak edit invoice yang sudah memiliki pembayaran', async () => {
      const transaction = {
        invoice: {
          findFirst: jest.fn(async () => ({
            id: 'invoice-1',
            totalAmount: 1_000_000,
            dueDate,
            cancelledAt: null,
            payments: [{ amount: 100_000, voidedAt: null }],
          })),
          update: jest.fn(),
        },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(transaction),
      );

      await expect(
        service.update('business-1', 'invoice-1', {
          issueDate,
          dueDate,
          totalAmount: 1_000_000,
        }),
      ).rejects.toBeInstanceOf(InvoiceLockedError);
      expect(transaction.invoice.update).not.toHaveBeenCalled();
    });

    it('mengizinkan edit invoice tanpa pembayaran', async () => {
      const transaction = {
        invoice: {
          findFirst: jest.fn(async () => ({
            id: 'invoice-1',
            totalAmount: 1_000_000,
            dueDate,
            cancelledAt: null,
            payments: [],
          })),
          update: jest.fn(async () => ({ id: 'invoice-1' })),
        },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(transaction),
      );

      await service.update('business-1', 'invoice-1', {
        issueDate,
        dueDate,
        totalAmount: 1_200_000,
        notes: 'Diperbarui',
      });

      expect(transaction.invoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: expect.objectContaining({ totalAmount: 1_200_000, notes: 'Diperbarui' }),
      });
    });

    it('menolak pembatalan invoice yang masih memiliki pembayaran valid', async () => {
      const transaction = {
        invoice: {
          findFirst: jest.fn(async () => ({
            id: 'invoice-1',
            cancelledAt: null,
            payments: [{ id: 'payment-1' }],
          })),
          update: jest.fn(),
        },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(transaction),
      );

      await expect(service.cancel('business-1', 'invoice-1', 'Salah')).rejects.toBeInstanceOf(
        InvoiceLockedError,
      );
      expect(transaction.invoice.update).not.toHaveBeenCalled();
    });

    it('membatalkan invoice setelah semua pembayaran di-void', async () => {
      const transaction = {
        invoice: {
          findFirst: jest.fn(async () => ({
            id: 'invoice-1',
            cancelledAt: null,
            payments: [],
          })),
          update: jest.fn(async () => ({ id: 'invoice-1' })),
        },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(transaction),
      );

      await service.cancel('business-1', 'invoice-1', 'Pelanggan membatalkan');

      expect(transaction.invoice.update).toHaveBeenCalledWith({
        where: { id: 'invoice-1' },
        data: {
          cancelledAt: expect.any(Date),
          cancellationReason: 'Pelanggan membatalkan',
        },
      });
    });
  });

  it('menghitung status invoice dari pembayaran valid', () => {
    const summary = service.summarize(
      invoiceRow({
        totalAmount: 1_000_000,
        payments: [{ amount: 400_000, voidedAt: null }],
      }),
    );

    expect(summary).toMatchObject({
      totalPaid: 400_000,
      outstanding: 600_000,
      status: 'PARTIAL',
    });
  });

  it('memfilter daftar berdasarkan status yang dihitung', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([
      invoiceRow({
        id: 'paid',
        payments: [{ amount: 1_000_000, voidedAt: null }],
      }),
      invoiceRow({ id: 'unpaid' }),
    ]);

    const result = await service.list({
      businessId: 'business-1',
      search: '',
      status: 'PAID',
      from: null,
      to: null,
      sort: 'created_desc',
      page: 1,
      perPage: 10,
    });

    expect(result.invoices).toHaveLength(1);
    expect(result.invoices[0].id).toBe('paid');
    expect(result.pagination.total).toBe(1);
  });

  it('membatasi detail invoice pada businessId', async () => {
    prismaMock.invoice.findFirst.mockResolvedValue(null);

    await expect(service.getById('business-1', 'invoice-lain')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('mengagregasi ringkasan keuangan tanpa invoice dibatalkan', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([
      invoiceRow({ totalAmount: 1_000_000, payments: [] }),
      invoiceRow({
        id: 'cancelled',
        totalAmount: 2_000_000,
        cancelledAt: new Date('2026-11-09T00:00:00Z'),
      }),
    ]);

    const summary = await service.getFinancialSummary('business-1');

    expect(summary.billedAmount).toBe(1_000_000);
    expect(summary.outstandingAmount).toBe(1_000_000);
    expect(summary.cancelledCount).toBe(1);
  });
});
