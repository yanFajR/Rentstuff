import type { Request } from 'express';
import { CsrfService } from './csrf.service.js';

function createRequest(sessionData: Record<string, unknown>): Request {
  return { session: sessionData } as unknown as Request;
}

describe('CsrfService', () => {
  const service = new CsrfService();

  it('membuat token acak berukuran 64 karakter hex', () => {
    const token = service.createToken();

    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(service.createToken()).not.toBe(token);
  });

  it('menyimpan token di session saat pertama kali diminta', () => {
    const request = createRequest({});

    const first = service.ensureToken(request);
    const second = service.ensureToken(request);

    expect(first).toHaveLength(64);
    expect(second).toBe(first);
  });

  it('merotasi token menjadi nilai baru', () => {
    const request = createRequest({});
    const original = service.ensureToken(request);

    const rotated = service.rotateToken(request);

    expect(rotated).not.toBe(original);
    expect(request.session.csrfToken).toBe(rotated);
  });

  it('menerima token yang cocok', () => {
    const request = createRequest({});
    const token = service.ensureToken(request);

    expect(service.isValid(request, token)).toBe(true);
  });

  it('menolak token yang salah, kosong, atau berbeda panjang', () => {
    const request = createRequest({});
    service.ensureToken(request);

    expect(service.isValid(request, 'token-palsu')).toBe(false);
    expect(service.isValid(request, '')).toBe(false);
    expect(service.isValid(request, undefined)).toBe(false);
    expect(service.isValid(request, 12345)).toBe(false);
  });

  it('menolak validasi jika session belum memiliki token', () => {
    const request = createRequest({});

    expect(service.isValid(request, 'apa-saja')).toBe(false);
  });
});
