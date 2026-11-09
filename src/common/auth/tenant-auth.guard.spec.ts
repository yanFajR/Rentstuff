import { jest } from '@jest/globals';
import type { ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { PrismaService } from '../prisma/prisma.service.js';
import type { SessionService } from '../session/session.service.js';
import { TenantAuthGuard } from './tenant-auth.guard.js';

type AnyFunction = (...args: any[]) => any;

const prismaMock = {
  businessMember: {
    findUnique: jest.fn<AnyFunction>(),
  },
};

const sessionMock = {
  terminate: jest.fn<AnyFunction>(),
};

function createContext(request: unknown, response: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ExecutionContext;
}

function createResponse(): Record<string, unknown> {
  return {
    locals: {},
    redirect: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn().mockReturnValue({ end: jest.fn() }),
    end: jest.fn(),
    clearCookie: jest.fn(),
  };
}

const membership = {
  id: 'member-1',
  userId: 'user-1',
  businessId: 'business-1',
  role: 'OWNER',
  user: {
    id: 'user-1',
    name: 'Budi Santoso',
    email: 'budi@example.com',
    isActive: true,
  },
  business: {
    id: 'business-1',
    name: 'Rental Maju',
    address: null,
    whatsappNumber: null,
    description: null,
  },
};

describe('TenantAuthGuard', () => {
  let guard: TenantAuthGuard;

  beforeEach(() => {
    guard = new TenantAuthGuard(
      prismaMock as unknown as PrismaService,
      sessionMock as unknown as SessionService,
    );
  });

  it('mengarahkan ke login jika session tidak memiliki identitas', async () => {
    const request = { session: {}, headers: {} } as unknown as Request;
    const response = createResponse();

    const allowed = await guard.canActivate(createContext(request, response));

    expect(allowed).toBe(false);
    expect(response.redirect).toHaveBeenCalledWith(302, '/login');
    expect(prismaMock.businessMember.findUnique).not.toHaveBeenCalled();
  });

  it('menolak akses jika membership tidak ditemukan', async () => {
    const request = {
      session: { userId: 'user-1', businessId: 'business-lain' },
      headers: {},
    } as unknown as Request;
    const response = createResponse();
    prismaMock.businessMember.findUnique.mockResolvedValue(null);

    const allowed = await guard.canActivate(createContext(request, response));

    expect(allowed).toBe(false);
    expect(sessionMock.terminate).toHaveBeenCalled();
    expect(response.redirect).toHaveBeenCalledWith(302, '/login');
  });

  it('menolak akses jika akun tidak aktif', async () => {
    const request = {
      session: { userId: 'user-1', businessId: 'business-1' },
      headers: {},
    } as unknown as Request;
    const response = createResponse();
    prismaMock.businessMember.findUnique.mockResolvedValue({
      ...membership,
      user: { ...membership.user, isActive: false },
    });

    const allowed = await guard.canActivate(createContext(request, response));

    expect(allowed).toBe(false);
    expect(sessionMock.terminate).toHaveBeenCalled();
  });

  it('menyediakan konteks autentikasi untuk membership yang valid', async () => {
    const request = {
      session: { userId: 'user-1', businessId: 'business-1' },
      headers: {},
    } as unknown as Request & { auth?: unknown };
    const response = createResponse();
    prismaMock.businessMember.findUnique.mockResolvedValue(membership);

    const allowed = await guard.canActivate(createContext(request, response));

    expect(allowed).toBe(true);
    expect(request.auth).toMatchObject({
      userId: 'user-1',
      businessId: 'business-1',
      role: 'OWNER',
      user: { name: 'Budi Santoso' },
      business: { name: 'Rental Maju' },
    });
    expect(response.locals).toMatchObject({
      currentUser: { initials: 'BS' },
      currentBusiness: { name: 'Rental Maju' },
    });
  });

  it('menolak businessId yang dikirim dari request', async () => {
    const request = {
      session: { userId: 'user-1', businessId: 'business-1' },
      headers: {},
      body: { businessId: 'business-lain' },
      query: {},
      params: {},
    } as unknown as Request;
    const response = createResponse();

    await expect(guard.canActivate(createContext(request, response))).rejects.toThrow(
      'Parameter businessId dari request tidak diizinkan',
    );
    expect(prismaMock.businessMember.findUnique).not.toHaveBeenCalled();
  });

  it('memakai redirect HTMX untuk request dari HTMX', async () => {
    const request = {
      session: {},
      headers: { 'hx-request': 'true' },
    } as unknown as Request;
    const response = createResponse();

    await guard.canActivate(createContext(request, response));

    expect(response.setHeader).toHaveBeenCalledWith('HX-Redirect', '/login');
  });
});
