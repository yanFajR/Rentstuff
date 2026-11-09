import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';

import type { PrismaService } from '../common/prisma/prisma.service.js';
import { parseDateOnly } from '../common/helpers/date-only.js';
import { ReminderSchedulerService } from './reminder-scheduler.service.js';
import { REMINDER_SKIP_REASONS } from './reminder-rules.js';

type AnyFunction = (...args: any[]) => any;

function uniqueError(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
  });
}

function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: 'invoice-1',
    businessId: 'business-1',
    totalAmount: 1_000_000,
    dueDate: parseDateOnly('2026-11-11'),
    cancelledAt: null,
    payments: [],
    ...overrides,
  };
}

function reminderJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 'reminder-1',
    businessId: 'business-1',
    invoiceId: 'invoice-1',
    reminderType: 'H_MINUS_3',
    scheduledDate: parseDateOnly('2026-11-08'),
    status: 'READY',
    skipReason: null,
    invoice: invoice(),
    ...overrides,
  };
}

describe('ReminderSchedulerService', () => {
  const transactionMock = {
    reminderJob: {
      create: jest.fn<AnyFunction>(),
      updateMany: jest.fn<AnyFunction>(),
    },
    reminderActivity: { create: jest.fn<AnyFunction>(), createMany: jest.fn<AnyFunction>() },
  };

  const prismaMock = {
    reminderJob: {
      findMany: jest.fn<AnyFunction>(),
      updateMany: jest.fn<AnyFunction>(),
    },
    reminderActivity: { create: jest.fn<AnyFunction>() },
    invoice: { findMany: jest.fn<AnyFunction>() },
    $transaction: jest.fn<AnyFunction>(),
  };

  let service: ReminderSchedulerService;

  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.reminderJob.findMany.mockResolvedValue([]);
    prismaMock.reminderJob.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.reminderActivity.create.mockResolvedValue({});
    prismaMock.invoice.findMany.mockResolvedValue([]);
    prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
      callback(transactionMock),
    );
    transactionMock.reminderJob.create.mockResolvedValue({ id: 'reminder-created' });
    transactionMock.reminderJob.updateMany.mockResolvedValue({ count: 0 });
    transactionMock.reminderActivity.create.mockResolvedValue({});
    transactionMock.reminderActivity.createMany.mockResolvedValue({ count: 0 });
    service = new ReminderSchedulerService(prismaMock as unknown as PrismaService);
  });

  it('membuat empat job untuk invoice H-3 dan menandai hanya H-3 sebagai READY', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([invoice()]);

    const result = await service.runOnce({ todayDate: '2026-11-08' });

    expect(result.created).toBe(4);
    expect(result.errors).toBe(0);
    expect(transactionMock.reminderJob.create).toHaveBeenCalledTimes(4);
    expect(
      transactionMock.reminderJob.create.mock.calls.map(([call]) => [
        call.data.reminderType,
        call.data.status,
        call.data.scheduledDate.toISOString().slice(0, 10),
      ]),
    ).toEqual([
      ['H_MINUS_3', 'READY', '2026-11-08'],
      ['H_MINUS_1', 'PENDING', '2026-11-10'],
      ['DUE_DATE', 'PENDING', '2026-11-11'],
      ['H_PLUS_1', 'PENDING', '2026-11-12'],
    ]);
    expect(transactionMock.reminderActivity.create).toHaveBeenCalledTimes(4);
    expect(transactionMock.reminderActivity.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        businessId: 'business-1',
        reminderId: 'reminder-created',
        activityType: 'CREATED',
      }),
    });
  });

  it('tidak membuat duplikat ketika unique constraint sudah ada', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([invoice()]);
    transactionMock.reminderJob.create.mockRejectedValue(uniqueError());

    const result = await service.runOnce({ todayDate: '2026-11-08' });

    expect(result.created).toBe(0);
    expect(result.errors).toBe(0);
    expect(transactionMock.reminderActivity.create).not.toHaveBeenCalled();
  });

  it('meneruskan invoice lain saat satu invoice gagal diproses', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([
      invoice({ id: 'invoice-gagal' }),
      invoice({ id: 'invoice-berhasil' }),
    ]);
    transactionMock.reminderJob.create.mockImplementation(
      async ({ data }: { data: { invoiceId: string } }) => {
        if (data.invoiceId === 'invoice-gagal') {
          throw new Error('Gagal simulasi');
        }
        return { id: `reminder-${data.invoiceId}` };
      },
    );

    const result = await service.runOnce({ todayDate: '2026-11-08' });

    expect(result.created).toBe(4);
    expect(result.errors).toBe(4);
    expect(
      transactionMock.reminderJob.create.mock.calls.some(
        ([call]) => call.data.invoiceId === 'invoice-berhasil',
      ),
    ).toBe(true);
  });

  it('melewati job dan mencatat alasan ketika invoice sudah lunas', async () => {
    prismaMock.reminderJob.findMany.mockResolvedValue([
      reminderJob({
        status: 'PENDING',
        invoice: invoice({ payments: [{ amount: 1_000_000, voidedAt: null }] }),
      }),
    ]);
    transactionMock.reminderJob.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.runOnce({ todayDate: '2026-11-08' });

    expect(result.skipped).toBe(1);
    expect(transactionMock.reminderJob.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['reminder-1'] }, status: { in: ['PENDING', 'READY'] } },
      data: {
        status: 'SKIPPED',
        skippedAt: expect.any(Date),
        skipReason: REMINDER_SKIP_REASONS.PAID,
      },
    });
    expect(transactionMock.reminderActivity.createMany).toHaveBeenCalledWith({
      data: [
        expect.objectContaining({
          activityType: 'SKIPPED',
          notes: REMINDER_SKIP_REASONS.PAID,
        }),
      ],
    });
  });

  it('melewati job ketika invoice dibatalkan', async () => {
    prismaMock.reminderJob.findMany.mockResolvedValue([
      reminderJob({ invoice: invoice({ cancelledAt: new Date('2026-11-08T00:00:00Z') }) }),
    ]);
    transactionMock.reminderJob.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.runOnce({ todayDate: '2026-11-08' });

    expect(result.skipped).toBe(1);
    expect(transactionMock.reminderJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'SKIPPED',
          skipReason: REMINDER_SKIP_REASONS.CANCELLED,
        }),
      }),
    );
  });

  it('melewati job ketika tanggal jatuh tempo berubah', async () => {
    prismaMock.reminderJob.findMany.mockResolvedValue([
      reminderJob({
        scheduledDate: parseDateOnly('2026-11-07'),
        invoice: invoice({ dueDate: parseDateOnly('2026-11-11') }),
      }),
    ]);
    transactionMock.reminderJob.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.runOnce({ todayDate: '2026-11-08' });

    expect(result.skipped).toBe(1);
    expect(transactionMock.reminderJob.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          skipReason: REMINDER_SKIP_REASONS.DUE_DATE_CHANGED,
        }),
      }),
    );
  });

  it('mempromosikan job PENDING yang jadwalnya sudah tiba', async () => {
    prismaMock.reminderJob.findMany.mockResolvedValue([
      reminderJob({ status: 'PENDING', scheduledDate: parseDateOnly('2026-11-08') }),
    ]);
    prismaMock.reminderJob.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.runOnce({ todayDate: '2026-11-08' });

    expect(result.promoted).toBe(1);
    expect(prismaMock.reminderJob.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['reminder-1'] }, status: 'PENDING' },
      data: { status: 'READY', processedAt: expect.any(Date) },
    });
  });

  it('mengaktifkan kembali job yang dilewati karena lunas setelah pembayaran di-void', async () => {
    prismaMock.reminderJob.findMany.mockResolvedValue([
      reminderJob({
        status: 'SKIPPED',
        skipReason: REMINDER_SKIP_REASONS.PAID,
        scheduledDate: parseDateOnly('2026-11-08'),
      }),
    ]);
    transactionMock.reminderJob.updateMany.mockResolvedValue({ count: 1 });

    const result = await service.runOnce({ todayDate: '2026-11-08' });

    expect(result.reactivated).toBe(1);
    expect(transactionMock.reminderJob.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['reminder-1'] }, status: 'SKIPPED' },
      data: {
        status: 'READY',
        skippedAt: null,
        skipReason: null,
        processedAt: expect.any(Date),
      },
    });
    expect(transactionMock.reminderActivity.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ activityType: 'REACTIVATED' })],
    });
  });

  it('tidak membuat job untuk invoice yang sudah lunas', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([
      invoice({ payments: [{ amount: 1_000_000, voidedAt: null }] }),
    ]);

    const result = await service.runOnce({ todayDate: '2026-11-08' });

    expect(result.created).toBe(0);
    expect(transactionMock.reminderJob.create).not.toHaveBeenCalled();
  });

  it('tidak memproses invoice yang dibatalkan', async () => {
    prismaMock.invoice.findMany.mockResolvedValue([
      invoice({ cancelledAt: new Date('2026-11-08T00:00:00Z') }),
    ]);

    const result = await service.runOnce({ todayDate: '2026-11-08' });

    expect(result.created).toBe(0);
  });

  it('membatasi proses manual pada businessId yang diberikan', async () => {
    await service.runOnce({ todayDate: '2026-11-08', businessId: 'business-1' });

    expect(prismaMock.reminderJob.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: 'business-1' }),
      }),
    );
    expect(prismaMock.invoice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ businessId: 'business-1' }),
      }),
    );
  });
});
