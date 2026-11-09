import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { testPrisma } from './utils/auth.js';
import { extractCsrfToken } from './utils/cookies.js';

process.env.AUTH_LOGIN_RATE_LIMIT = '3';
process.env.AUTH_LOGIN_RATE_WINDOW_MS = '60000';
process.env.AUTH_REGISTER_RATE_LIMIT = '3';
process.env.AUTH_REGISTER_RATE_WINDOW_MS = '60000';

describe('Rate limiting autentikasi (e2e)', () => {
  let app: NestExpressApplication;
  let server: ReturnType<NestExpressApplication['getHttpServer']>;

  beforeAll(async () => {
    const [{ AppModule }, { configureApplication }] = await Promise.all([
      import('../src/app.module.js'),
      import('../src/app.setup.js'),
    ]);
    const { Test } = await import('@nestjs/testing');

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
    configureApplication(app);
    await app.init();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    await testPrisma.$disconnect();
  });

  it('membatasi percobaan login yang gagal berulang', async () => {
    const agent = request.agent(server);
    const page = await agent.get('/login').expect(200);
    const csrfToken = extractCsrfToken(page.text);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await agent
        .post('/login')
        .type('form')
        .send({ _csrf: csrfToken, email: 'tidak-ada@example.com', password: 'Salah123' });

      expect(response.status).toBe(422);
    }

    const blocked = await agent
      .post('/login')
      .type('form')
      .send({ _csrf: csrfToken, email: 'tidak-ada@example.com', password: 'Salah123' });

    expect(blocked.status).toBe(429);
    expect(blocked.text).toContain('Terlalu banyak percobaan');
  });

  it('membatasi percobaan registrasi berulang', async () => {
    const agent = request.agent(server);
    const page = await agent.get('/register').expect(200);
    const csrfToken = extractCsrfToken(page.text);

    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await agent.post('/register').type('form').send({
        _csrf: csrfToken,
        name: '',
        email: 'bukan-email',
        password: 'pendek',
        confirmPassword: 'beda',
        businessName: '',
      });

      expect(response.status).toBe(422);
    }

    const blocked = await agent.post('/register').type('form').send({
      _csrf: csrfToken,
      name: '',
      email: 'bukan-email',
      password: 'pendek',
      confirmPassword: 'beda',
      businessName: '',
    });

    expect(blocked.status).toBe(429);
    expect(blocked.text).toContain('Terlalu banyak percobaan');
  });
});
