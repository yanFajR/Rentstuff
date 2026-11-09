import { jest } from '@jest/globals';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../common/prisma/prisma.service.js';
import {
  PaymentExceedsOutstandingError,
  PaymentNotAllowedError,
  PaymentService,
} from './payment.service.js';

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
  payment: {
    findFirst: jest.fn<AnyFunction>(),
    findMany: jest.fn<AnyFunction>(),
    count: jest.fn<AnyFunction>(),
  },
};

const configMock = {
  get: jest.fn((key: string) => (key === 'app.timezone' ? 'Asia/Jakarta' : undefined)),
};

const paymentDate = new Date('2026-11-10T00:00:00.000Z');

function invoiceSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    totalAmount: 1_000_000,
    dueDate: new Date('2099-01-01T00:00:00.000Z'),
    cancelledAt: null,
    payments: [],
    ...overrides,
  };
}

describe('PaymentService', () => {
  let service: PaymentService;

  beforeEach(() => {
    service = new PaymentService(
      prismaMock as unknown as PrismaService,
      configMock as unknown as ConfigService,
      reminderSchedulerMock as never,
    );
  });

  describe('record', () => {
    it('mencatat pembayaran valid dalam transaksi', async () => {
      const transaction = {
        invoice: { findFirst: jest.fn(async () => invoiceSnapshot()) },
        payment: {
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'payment-1',
            ...data,
          })),
          aggregate: jest.fn(async () => ({ _sum: { amount: 500_000 } })),
        },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(transaction),
      );

      const payment = await service.record('business-1', 'invoice-1', 'user-1', {
        amount: 500_000,
        paymentDate,
        method: 'BANK_TRANSFER',
        reference: 'TRX-1',
        notes: '  Transfer  ',
      });

      expect(payment).toMatchObject({ id: 'payment-1', amount: 500_000 });
      expect(transaction.payment.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          businessId: 'business-1',
          invoiceId: 'invoice-1',
          amount: 500_000,
          method: 'BANK_TRANSFER',
          reference: 'TRX-1',
          notes: 'Transfer',
          recordedByUserId: 'user-1',
        }),
      });
    });

    it('menolak pembayaran melebihi sisa tagihan', async () => {
      const transaction = {
        invoice: {
          findFirst: jest.fn(async () =>
            invoiceSnapshot({ payments: [{ amount: 400_000, voidedAt: null }] }),
          ),
        },
        payment: { create: jest.fn(), aggregate: jest.fn() },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(transaction),
      );

      await expect(
        service.record('business-1', 'invoice-1', 'user-1', {
          amount: 700_000,
          paymentDate,
          method: 'CASH',
        }),
      ).rejects.toBeInstanceOf(PaymentExceedsOutstandingError);
      expect(transaction.payment.create).not.toHaveBeenCalled();
    });

    it('menolak pembayaran pada invoice lunas atau dibatalkan', async () => {
      const paid = {
        invoice: {
          findFirst: jest.fn(async () =>
            invoiceSnapshot({ payments: [{ amount: 1_000_000, voidedAt: null }] }),
          ),
        },
        payment: { create: jest.fn(), aggregate: jest.fn() },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) => callback(paid));

      await expect(
        service.record('business-1', 'invoice-1', 'user-1', {
          amount: 100,
          paymentDate,
          method: 'CASH',
        }),
      ).rejects.toBeInstanceOf(PaymentNotAllowedError);

      const cancelled = {
        invoice: {
          findFirst: jest.fn(async () => invoiceSnapshot({ cancelledAt: new Date() })),
        },
        payment: { create: jest.fn(), aggregate: jest.fn() },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(cancelled),
      );

      await expect(
        service.record('business-1', 'invoice-1', 'user-1', {
          amount: 100,
          paymentDate,
          method: 'CASH',
        }),
      ).rejects.toBeInstanceOf(PaymentNotAllowedError);
    });

    it('menolak invoice dari bisnis lain', async () => {
      const transaction = {
        invoice: { findFirst: jest.fn(async () => null) },
        payment: { create: jest.fn(), aggregate: jest.fn() },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(transaction),
      );

      await expect(
        service.record('business-1', 'invoice-b', 'user-1', {
          amount: 100,
          paymentDate,
          method: 'CASH',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('menolak nominal tidak positif di level service', async () => {
      await expect(
        service.record('business-1', 'invoice-1', 'user-1', {
          amount: 0,
          paymentDate,
          method: 'CASH',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('void', () => {
    it('mem-void pembayaran dengan alasan dan user', async () => {
      const transaction = {
        payment: {
          findFirst: jest.fn(async () => ({
            id: 'payment-1',
            invoiceId: 'invoice-1',
            voidedAt: null,
          })),
          update: jest.fn(async () => ({ id: 'payment-1' })),
        },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(transaction),
      );

      await service.void('business-1', 'payment-1', 'user-1', '  Salah input  ');

      expect(transaction.payment.update).toHaveBeenCalledWith({
        where: { id: 'payment-1' },
        data: {
          voidedAt: expect.any(Date),
          voidReason: 'Salah input',
          voidedByUserId: 'user-1',
        },
      });
    });

    it('menolak void kedua kali', async () => {
      const transaction = {
        payment: {
          findFirst: jest.fn(async () => ({
            id: 'payment-1',
            invoiceId: 'invoice-1',
            voidedAt: new Date('2026-11-11T00:00:00Z'),
          })),
          update: jest.fn(),
        },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(transaction),
      );

      await expect(
        service.void('business-1', 'payment-1', 'user-1', 'Lagi'),
      ).rejects.toBeInstanceOf(PaymentNotAllowedError);
      expect(transaction.payment.update).not.toHaveBeenCalled();
    });

    it('menolak void tanpa alasan', async () => {
      await expect(service.void('business-1', 'payment-1', 'user-1', '   ')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('menolak void pembayaran bisnis lain', async () => {
      const transaction = {
        payment: {
          findFirst: jest.fn(async () => null),
          update: jest.fn(),
        },
      };
      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(transaction),
      );

      await expect(
        service.void('business-1', 'payment-b', 'user-1', 'Salah'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  it('membatasi daftar pembayaran pada businessId dan status', async () => {
    prismaMock.payment.count.mockResolvedValue(1);
    prismaMock.payment.findMany.mockResolvedValue([]);

    await service.list({
      businessId: 'business-1',
      search: '',
      status: 'valid',
      page: 1,
      perPage: 10,
    });

    expect(prismaMock.payment.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { businessId: 'business-1', voidedAt: null },
      }),
    );
  });
});
