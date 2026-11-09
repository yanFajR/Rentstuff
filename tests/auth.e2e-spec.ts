import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { attemptLogin, registerTestUser, testPrisma } from './utils/auth.js';
import {
  extractCsrfToken,
  extractSessionCookie,
  fetchCsrfToken,
  sessionIdFromCookie,
  uniqueEmail,
} from './utils/cookies.js';
import { createTestApplication } from './utils/create-app.js';

describe('Authentication (e2e)', () => {
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

  it('mendaftarkan user, bisnis, membership OWNER, dan sesi dalam satu alur', async () => {
    const agent = request.agent(server);
    const csrfToken = await fetchCsrfToken(agent, '/register');
    const email = uniqueEmail('register');
    const password = 'Rahasia123';

    const response = await agent
      .post('/register')
      .type('form')
      .send({
        _csrf: csrfToken,
        name: '  Siti Aminah  ',
        email: `  ${email.toUpperCase()}  `,
        password,
        confirmPassword: password,
        businessName: '  Rental Berkah  ',
      })
      .expect(303);

    expect(response.headers.location).toBe('/dashboard');
    const sessionCookie = extractSessionCookie(response.headers as Record<string, unknown>);
    const sessionId = sessionIdFromCookie(sessionCookie);

    const user = await testPrisma.user.findUniqueOrThrow({ where: { email } });
    expect(user.name).toBe('Siti Aminah');
    expect(user.passwordHash).not.toBe(password);
    expect(user.passwordHash.startsWith('$2')).toBe(true);
    expect(user.isActive).toBe(true);

    const membership = await testPrisma.businessMember.findFirstOrThrow({
      where: { userId: user.id },
    });
    expect(membership.role).toBe('OWNER');
    const business = await testPrisma.business.findUniqueOrThrow({
      where: { id: membership.businessId },
    });
    expect(business.name).toBe('Rental Berkah');

    const session = await testPrisma.session.findUnique({ where: { id: sessionId } });
    expect(session).not.toBeNull();

    const dashboard = await agent.get('/dashboard').expect(200);
    expect(dashboard.text).toContain('Rental Berkah');
    expect(dashboard.text).toContain('Siti Aminah');
    expect(dashboard.text).toContain('Ringkasan bisnis');
  });

  it('menolak registrasi dengan email duplikat setelah normalisasi', async () => {
    const existing = await registerTestUser(server, { businessName: 'Rental Pertama' });
    const agent = request.agent(server);
    const csrfToken = await fetchCsrfToken(agent, '/register');

    const response = await agent
      .post('/register')
      .type('form')
      .send({
        _csrf: csrfToken,
        name: 'Pendaftar Kedua',
        email: `  ${existing.email.toUpperCase()}  `,
        password: 'Rahasia123',
        confirmPassword: 'Rahasia123',
        businessName: 'Rental Duplikat',
      })
      .expect(422);

    expect(response.text).toContain('Email sudah terdaftar');

    const users = await testPrisma.user.count({ where: { email: existing.email } });
    const duplicateBusinesses = await testPrisma.business.count({
      where: { name: 'Rental Duplikat' },
    });

    expect(users).toBe(1);
    expect(duplicateBusinesses).toBe(0);
  });

  it('menolak registrasi dengan input tidak valid', async () => {
    const agent = request.agent(server);
    const csrfToken = await fetchCsrfToken(agent, '/register');

    const response = await agent
      .post('/register')
      .type('form')
      .send({
        _csrf: csrfToken,
        name: '',
        email: 'bukan-email',
        password: 'pendek',
        confirmPassword: 'beda',
        businessName: '',
      })
      .expect(422);

    expect(response.text).toContain('Nama lengkap');
    expect(response.text).toContain('Format email tidak valid');
    expect(response.text).toContain('Kata sandi');
    expect(response.text).toContain('angka');
    expect(response.text).toContain('Nama bisnis');
    expect(response.text).toContain('Konfirmasi kata sandi tidak cocok');

    const user = await testPrisma.user.findUnique({ where: { email: 'bukan-email' } });
    expect(user).toBeNull();
  });

  it('login berhasil dan mengarahkan ke dashboard', async () => {
    const created = await registerTestUser(server, { businessName: 'Rental Login' });

    const attempt = await attemptLogin(server, created.email, created.password);

    expect(attempt.status).toBe(303);
    expect(attempt.location).toBe('/dashboard');
    expect(attempt.cookie).not.toBeNull();

    const dashboard = await attempt.agent.get('/dashboard').expect(200);
    expect(dashboard.text).toContain('Rental Login');
  });

  it('menolak password salah tanpa mengungkap status email', async () => {
    const created = await registerTestUser(server);

    const wrongPassword = await attemptLogin(server, created.email, 'Salah123');
    const unknownEmail = await attemptLogin(server, uniqueEmail('tidak-ada'), 'Salah123');

    expect(wrongPassword.status).toBe(422);
    expect(unknownEmail.status).toBe(422);
    expect(wrongPassword.text).toContain('Email atau kata sandi salah.');
    expect(unknownEmail.text).toContain('Email atau kata sandi salah.');
  });

  it('menyimpan session cookie dengan atribut keamanan yang benar', async () => {
    const agent = request.agent(server);
    const response = await agent.get('/login').expect(200);

    const setCookie = response.headers['set-cookie'] as unknown as string[];
    const cookie = setCookie.find((value) => value.startsWith('rental_reminder.sid='));

    expect(cookie).toBeDefined();
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Secure');
  });

  it('mencegah session fixation dengan regenerasi session saat login', async () => {
    const created = await registerTestUser(server);
    const agent = request.agent(server);

    const loginPage = await agent.get('/login').expect(200);
    const oldCookie = extractSessionCookie(loginPage.headers as Record<string, unknown>);
    const csrfToken = extractCsrfToken(loginPage.text);

    const login = await agent
      .post('/login')
      .type('form')
      .send({ _csrf: csrfToken, email: created.email, password: created.password })
      .expect(303);

    const newCookie = extractSessionCookie(login.headers as Record<string, unknown>);
    const oldSessionId = sessionIdFromCookie(oldCookie);

    expect(newCookie).not.toBe(oldCookie);
    expect(await testPrisma.session.findUnique({ where: { id: oldSessionId } })).toBeNull();

    const oldSessionAttempt = await request(server).get('/dashboard').set('Cookie', oldCookie);

    expect(oldSessionAttempt.status).toBe(302);
    expect(oldSessionAttempt.headers.location).toBe('/login');
  });

  it('logout menghapus session dan membuat session lama tidak berlaku', async () => {
    const created = await registerTestUser(server, { businessName: 'Rental Logout' });

    const dashboard = await created.agent.get('/dashboard').expect(200);
    const csrfToken = extractCsrfToken(dashboard.text);

    const logout = await created.agent
      .post('/logout')
      .type('form')
      .send({ _csrf: csrfToken })
      .expect(303);

    expect(logout.headers.location).toBe('/login?status=logged-out');
    expect(await testPrisma.session.findUnique({ where: { id: created.sessionId } })).toBeNull();

    await created.agent.get('/dashboard').expect(302).expect('Location', '/login');

    const loginPage = await created.agent.get('/login?status=logged-out').expect(200);
    expect(loginPage.text).toContain('Anda telah keluar dari akun ini.');
  });

  it('menolak login untuk akun yang tidak aktif', async () => {
    const created = await registerTestUser(server);
    await testPrisma.user.update({ where: { id: created.userId }, data: { isActive: false } });

    const attempt = await attemptLogin(server, created.email, created.password);

    expect(attempt.status).toBe(403);
    expect(attempt.text).toContain('Akun Anda tidak aktif');

    await created.agent.get('/dashboard').expect(302).expect('Location', '/login');
  });

  it('menolak password yang melebihi 72 byte UTF-8 saat registrasi', async () => {
    const agent = request.agent(server);
    const csrfToken = await fetchCsrfToken(agent, '/register');
    const email = uniqueEmail('byte-limit');
    const password = `${'é'.repeat(36)}A1`;

    const response = await agent
      .post('/register')
      .type('form')
      .send({
        _csrf: csrfToken,
        name: 'Batas Byte',
        email,
        password,
        confirmPassword: password,
        businessName: 'Rental Batas Byte',
      })
      .expect(422);

    expect(response.text).toContain('72 byte');
    expect(await testPrisma.user.findUnique({ where: { email } })).toBeNull();
  });

  it('menolak login dengan password yang melewati batas byte bcrypt', async () => {
    const password = `${'a'.repeat(70)}A1`;
    const created = await registerTestUser(server, { password });

    const attempt = await attemptLogin(server, created.email, `${password}x`);

    expect(attempt.status).toBe(422);
    expect(attempt.text).toContain('72 byte');
  });
});
