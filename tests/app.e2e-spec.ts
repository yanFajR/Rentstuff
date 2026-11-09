import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { testPrisma } from './utils/auth.js';
import { createTestApplication } from './utils/create-app.js';

describe('Rental Reminder (e2e)', () => {
  let app: NestExpressApplication;
  let server: ReturnType<NestExpressApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApplication();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    await testPrisma.$disconnect();
  });

  it('mengalihkan halaman utama ke dashboard', async () => {
    await request(server).get('/').expect(302).expect('Location', '/dashboard');
  });

  it('mengalihkan dashboard ke login jika belum terautentikasi', async () => {
    await request(server).get('/dashboard').expect(302).expect('Location', '/login');
  });

  it('mengalihkan profil bisnis ke login jika belum terautentikasi', async () => {
    await request(server).get('/settings').expect(302).expect('Location', '/login');
  });

  it('menampilkan halaman login dengan tautan pendaftaran', async () => {
    const response = await request(server).get('/login').expect(200);

    expect(response.text).toContain('Masuk ke akun Anda');
    expect(response.text).toContain('Daftar sekarang');
    expect(response.text).toContain('name="_csrf"');
  });

  it('menampilkan halaman registrasi', async () => {
    const response = await request(server).get('/register').expect(200);

    expect(response.text).toContain('Daftar akun baru');
    expect(response.text).toContain('Nama bisnis');
    expect(response.text).toContain('name="_csrf"');
  });

  it('mengembalikan liveness minimal tanpa detail internal', async () => {
    const response = await request(server).get('/health').expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'rental-reminder',
    });
    expect(response.body).not.toHaveProperty('database');
    expect(response.body).not.toHaveProperty('environment');
    expect(response.body).not.toHaveProperty('timezone');
    expect(typeof response.body.uptimeSeconds).toBe('number');
  });

  it('mengembalikan readiness berdasarkan koneksi database', async () => {
    const response = await request(server).get('/health/ready').expect(200);

    expect(response.body).toMatchObject({ status: 'ok' });
    expect(response.body).not.toHaveProperty('database');
    expect(response.body).not.toHaveProperty('latencyMs');
    expect(response.body).not.toHaveProperty('environment');
  });

  it('merender partial status sistem untuk HTMX', async () => {
    const response = await request(server).get('/health/partial').expect(200);

    expect(response.headers['content-type']).toContain('text/html');
    expect(response.text).toContain('Semua sistem berjalan normal');
    expect(response.text).toContain('Siap');
    expect(response.text).not.toContain('provider');
  });

  it('menerapkan header keamanan', async () => {
    const response = await request(server).get('/login').expect(200);

    expect(response.headers['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-frame-options']).toBe('DENY');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['permissions-policy']).toContain('camera=()');
  });

  it('merender halaman 404 untuk permintaan HTML', async () => {
    const response = await request(server)
      .get('/halaman-tidak-ada')
      .set('Accept', 'text/html')
      .expect(404);

    expect(response.text).toContain('Halaman tidak ditemukan');
  });

  it('mengembalikan JSON untuk permintaan non-HTML', async () => {
    const response = await request(server)
      .get('/halaman-tidak-ada')
      .set('Accept', 'application/json')
      .expect(404);

    expect(response.body).toMatchObject({ statusCode: 404 });
    expect(response.body.path).toBe('/halaman-tidak-ada');
  });
});
