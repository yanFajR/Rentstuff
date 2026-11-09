import { jest } from '@jest/globals';
import { Prisma } from '@prisma/client';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../common/prisma/prisma.service.js';
import { AuthService, EmailAlreadyRegisteredError } from './auth.service.js';
import { PasswordService } from './password.service.js';

type AnyFunction = (...args: any[]) => any;

const prismaMock = {
  $transaction: jest.fn<AnyFunction>(),
  user: {
    findUnique: jest.fn<AnyFunction>(),
  },
};

const passwordMock = {
  hash: jest.fn<AnyFunction>(),
  verify: jest.fn<AnyFunction>(),
  runTimingEqualizer: jest.fn<AnyFunction>(),
};

const registerInput = {
  name: '  Budi Santoso  ',
  email: '  Budi.Santoso@Example.COM ',
  password: 'Rahasia123',
  businessName: '  Rental Maju  ',
};

describe('AuthService', () => {
  let service: AuthService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: PasswordService, useValue: passwordMock },
      ],
    }).compile();

    service = moduleRef.get(AuthService);
    passwordMock.hash.mockResolvedValue('hashed-password');
    passwordMock.runTimingEqualizer.mockResolvedValue(undefined);
  });

  describe('register', () => {
    it('membuat user, bisnis, dan membership OWNER dalam satu transaction', async () => {
      const transaction = {
        user: {
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'user-1',
            ...data,
          })),
        },
        business: {
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'business-1',
            ...data,
          })),
        },
        businessMember: {
          create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
            id: 'member-1',
            ...data,
          })),
        },
      };

      prismaMock.$transaction.mockImplementation(async (callback: AnyFunction) =>
        callback(transaction),
      );

      const result = await service.register(registerInput);

      expect(result).toEqual({ userId: 'user-1', businessId: 'business-1' });
      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(passwordMock.hash).toHaveBeenCalledWith('Rahasia123');
      expect(transaction.user.create).toHaveBeenCalledWith({
        data: {
          name: 'Budi Santoso',
          email: 'budi.santoso@example.com',
          passwordHash: 'hashed-password',
        },
      });
      expect(transaction.business.create).toHaveBeenCalledWith({
        data: { name: 'Rental Maju' },
      });
      expect(transaction.businessMember.create).toHaveBeenCalledWith({
        data: { userId: 'user-1', businessId: 'business-1', role: 'OWNER' },
      });
    });

    it('menolak email yang sudah terdaftar', async () => {
      prismaMock.$transaction.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(service.register(registerInput)).rejects.toBeInstanceOf(
        EmailAlreadyRegisteredError,
      );
    });

    it('meneruskan error database lain tanpa menelan informasi', async () => {
      prismaMock.$transaction.mockRejectedValue(new Error('database tidak tersedia'));

      await expect(service.register(registerInput)).rejects.toThrow('database tidak tersedia');
    });
  });

  describe('authenticate', () => {
    const activeUser = {
      id: 'user-1',
      name: 'Budi',
      email: 'budi@example.com',
      passwordHash: 'hashed-password',
      isActive: true,
      memberships: [
        {
          id: 'member-1',
          businessId: 'business-1',
          role: 'OWNER',
          business: { id: 'business-1', name: 'Rental Maju' },
        },
      ],
    };

    it('mengembalikan status invalid untuk email yang tidak terdaftar', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const result = await service.authenticate('tidak-ada@example.com', 'Rahasia123');

      expect(result).toEqual({ status: 'invalid' });
      expect(passwordMock.runTimingEqualizer).toHaveBeenCalledWith('Rahasia123');
    });

    it('mengembalikan status invalid untuk kata sandi yang salah', async () => {
      prismaMock.user.findUnique.mockResolvedValue(activeUser);
      passwordMock.verify.mockResolvedValue(false);

      const result = await service.authenticate('budi@example.com', 'Salah123');

      expect(result).toEqual({ status: 'invalid' });
    });

    it('mengembalikan status invalid untuk email tidak terdaftar dengan pesan yang sama', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const missing = await service.authenticate('tidak-ada@example.com', 'apapun123');
      prismaMock.user.findUnique.mockResolvedValue(activeUser);
      passwordMock.verify.mockResolvedValue(false);
      const wrongPassword = await service.authenticate('budi@example.com', 'apapun123');

      expect(missing).toEqual(wrongPassword);
    });

    it('menolak akun yang tidak aktif', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ ...activeUser, isActive: false });
      passwordMock.verify.mockResolvedValue(true);

      const result = await service.authenticate('budi@example.com', 'Rahasia123');

      expect(result).toEqual({ status: 'inactive' });
    });

    it('menolak akun tanpa membership bisnis', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ ...activeUser, memberships: [] });
      passwordMock.verify.mockResolvedValue(true);

      const result = await service.authenticate('budi@example.com', 'Rahasia123');

      expect(result).toEqual({ status: 'no-business' });
    });

    it('mengembalikan identitas bisnis saat kredensial valid', async () => {
      prismaMock.user.findUnique.mockResolvedValue(activeUser);
      passwordMock.verify.mockResolvedValue(true);

      const result = await service.authenticate('  Budi@Example.com ', 'Rahasia123');

      expect(result).toEqual({
        status: 'success',
        userId: 'user-1',
        businessId: 'business-1',
        userName: 'Budi',
        businessName: 'Rental Maju',
        role: 'OWNER',
      });
      expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { email: 'budi@example.com' } }),
      );
    });
  });
});
