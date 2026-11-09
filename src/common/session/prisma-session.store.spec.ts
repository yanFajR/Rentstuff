import { jest } from '@jest/globals';
import type expressSession from 'express-session';

import type { PrismaService } from '../prisma/prisma.service.js';
import { PrismaSessionStore } from './prisma-session.store.js';

type AnyFunction = (...args: any[]) => any;

const prismaMock = {
  session: {
    findUnique: jest.fn<AnyFunction>(),
    deleteMany: jest.fn<AnyFunction>(),
    upsert: jest.fn<AnyFunction>(),
    updateMany: jest.fn<AnyFunction>(),
    count: jest.fn<AnyFunction>(),
  },
};

const TTL_MS = 60_000;

function createStore(): PrismaSessionStore {
  return new PrismaSessionStore(prismaMock as unknown as PrismaService, TTL_MS);
}

function getSession(
  store: PrismaSessionStore,
  sid: string,
): Promise<expressSession.SessionData | null> {
  return new Promise((resolve, reject) => {
    store.get(sid, (error, sessionData) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(sessionData ?? null);
    });
  });
}

function setSession(
  store: PrismaSessionStore,
  sid: string,
  data: expressSession.SessionData,
): Promise<void> {
  return new Promise((resolve, reject) => {
    store.set(sid, data, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

describe('PrismaSessionStore', () => {
  let store: PrismaSessionStore;

  beforeEach(() => {
    store = createStore();
    prismaMock.session.deleteMany.mockResolvedValue({ count: 1 });
  });

  it('mengembalikan session yang tersimpan dan belum kedaluwarsa', async () => {
    const sessionData = { cookie: { maxAge: TTL_MS }, userId: 'user-1' };
    prismaMock.session.findUnique.mockResolvedValue({
      data: JSON.stringify(sessionData),
      expiresAt: new Date(Date.now() + TTL_MS),
    });

    const result = await getSession(store, 'sid-1');

    expect(result).toEqual(sessionData);
    expect(prismaMock.session.findUnique).toHaveBeenCalledWith({
      where: { id: 'sid-1' },
      select: { data: true, expiresAt: true },
    });
  });

  it('mengembalikan null dan menghapus session yang kedaluwarsa', async () => {
    prismaMock.session.findUnique.mockResolvedValue({
      data: JSON.stringify({ userId: 'user-1' }),
      expiresAt: new Date(Date.now() - 1_000),
    });

    const result = await getSession(store, 'sid-expired');

    expect(result).toBeNull();
    expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({
      where: { id: 'sid-expired' },
    });
  });

  it('mengembalikan null untuk session yang tidak ada', async () => {
    prismaMock.session.findUnique.mockResolvedValue(null);

    await expect(getSession(store, 'sid-missing')).resolves.toBeNull();
  });

  it('menghapus data yang rusak alih-alih melempar error', async () => {
    prismaMock.session.findUnique.mockResolvedValue({
      data: 'bukan-json',
      expiresAt: new Date(Date.now() + TTL_MS),
    });

    await expect(getSession(store, 'sid-rusak')).resolves.toBeNull();
    expect(prismaMock.session.deleteMany).toHaveBeenCalled();
  });

  it('menyimpan session sebagai JSON dengan waktu kedaluwarsa dari cookie', async () => {
    const expiresAt = new Date('2026-12-01T10:00:00.000Z');
    const sessionData = { cookie: { expires: expiresAt.toISOString() }, userId: 'user-1' };

    await setSession(store, 'sid-1', sessionData as unknown as expressSession.SessionData);

    expect(prismaMock.session.upsert).toHaveBeenCalledWith({
      where: { id: 'sid-1' },
      create: {
        id: 'sid-1',
        data: JSON.stringify(sessionData),
        expiresAt,
      },
      update: {
        data: JSON.stringify(sessionData),
        expiresAt,
      },
    });
  });

  it('memakai TTL bawaan jika cookie tidak memiliki waktu kedaluwarsa', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-08T00:00:00.000Z') });
    try {
      await setSession(store, 'sid-2', { userId: 'user-1' } as expressSession.SessionData);

      const call = prismaMock.session.upsert.mock.calls[0] as [{ create: { expiresAt: Date } }];
      expect(call[0].create.expiresAt.toISOString()).toBe('2026-11-08T00:01:00.000Z');
    } finally {
      jest.useRealTimers();
    }
  });

  it('menghapus session berdasarkan sid', async () => {
    await new Promise<void>((resolve) => {
      store.destroy('sid-1', () => resolve());
    });

    expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({ where: { id: 'sid-1' } });
  });

  it('memperbarui waktu kedaluwarsa saat touch', async () => {
    prismaMock.session.updateMany.mockResolvedValue({ count: 1 });

    await new Promise<void>((resolve) => {
      store.touch(
        'sid-1',
        { cookie: { expires: new Date('2026-12-02T00:00:00.000Z') } } as expressSession.SessionData,
        () => resolve(),
      );
    });

    expect(prismaMock.session.updateMany).toHaveBeenCalledWith({
      where: { id: 'sid-1' },
      data: { expiresAt: new Date('2026-12-02T00:00:00.000Z') },
    });
  });

  it('menghitung hanya session aktif', async () => {
    prismaMock.session.count.mockResolvedValue(3);

    const length = await new Promise<number>((resolve, reject) => {
      store.length((error, value) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(value ?? 0);
      });
    });

    expect(length).toBe(3);
    expect(prismaMock.session.count).toHaveBeenCalledWith({
      where: { expiresAt: { gt: expect.any(Date) } },
    });
  });
});
