import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { registerTestUser, testPrisma } from './utils/auth.js';
import { extractCsrfToken } from './utils/cookies.js';
import { createCustomer } from './utils/domain.js';
import { createTestApplication } from './utils/create-app.js';

describe('Keamanan (e2e)', () => {
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

  it('menolak POST login tanpa token CSRF', async () => {
    const response = await request(server)
      .post('/login')
      .type('form')
      .send({ email: 'budi@example.com', password: 'Rahasia123' })
      .expect(403);

    expect(response.text).toContain('Sesi keamanan tidak valid');
  });

  it('menolak POST login dengan token CSRF yang salah', async () => {
    const agent = request.agent(server);
    await agent.get('/login').expect(200);

    const response = await agent
      .post('/login')
      .type('form')
      .send({ _csrf: 'token-palsu', email: 'budi@example.com', password: 'Rahasia123' })
      .expect(403);

    expect(response.text).toContain('Sesi keamanan tidak valid');
  });

  it('menolak logout tanpa token CSRF dan tetap mempertahankan sesi', async () => {
    const owner = await registerTestUser(server);

    await owner.agent.post('/logout').type('form').send({}).expect(403);

    await owner.agent.get('/dashboard').expect(200);
  });

  it('menolak perubahan profil bisnis tanpa token CSRF', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Aman' });

    await owner.agent
      .post('/settings/business')
      .type('form')
      .send({
        businessName: 'Rental Dibajak',
        ownerName: 'Penyerang',
        whatsappNumber: '081200000000',
      })
      .expect(403);

    const business = await testPrisma.business.findUniqueOrThrow({
      where: { id: owner.businessId },
    });
    expect(business.name).toBe('Rental Aman');
  });

  it('menerima request perubahan dengan token CSRF yang valid', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Valid' });
    const dashboard = await owner.agent.get('/dashboard').expect(200);
    const csrfToken = extractCsrfToken(dashboard.text);

    await owner.agent
      .post('/settings/business')
      .type('form')
      .send({
        _csrf: csrfToken,
        businessName: 'Rental Valid Diperbarui',
        ownerName: 'Nama Valid',
        whatsappNumber: '',
        address: '',
        description: '',
      })
      .expect(303);
  });

  it('tidak membocorkan stack trace pada halaman error di mode test', async () => {
    const response = await request(server).get('/tidak-ada').set('Accept', 'text/html').expect(404);

    expect(response.text).not.toContain('at Object.');
    expect(response.text).not.toContain('node_modules');
  });

  it('menerapkan atribut cookie session yang aman', async () => {
    const response = await request(server).get('/login').expect(200);
    const setCookie = String(response.headers['set-cookie']);

    expect(setCookie).toContain('rental_reminder.sid=');
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Path=/');
  });

  it('meng-escape nama pelanggan yang berisi HTML', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental XSS' });
    const customer = await createCustomer(owner.agent, {
      name: '<script>alert(1)</script>',
      whatsappNumber: '081255590001',
    });

    const page = await owner.agent.get('/customers').expect(200);
    expect(page.text).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(page.text).not.toContain('<script>alert(1)</script>');
    expect(page.text).not.toContain(customer.name);
  });

  it('mencari dengan input berbahaya tetap aman melalui Prisma', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Injection' });
    await createCustomer(owner.agent, {
      name: 'Pelanggan Aman',
      whatsappNumber: '081255590002',
    });

    const page = await owner.agent.get("/customers?q=' OR 1=1 --").expect(200);
    expect(page.text).not.toContain('Pelanggan Aman');
    expect(page.text).toContain('Pelanggan tidak ditemukan');
  });

  it('tidak menampilkan query string sensitif pada respons error JSON', async () => {
    const response = await request(server)
      .get('/tidak-ada?email=rahasia@example.com&token=abc')
      .set('Accept', 'application/json')
      .expect(404);

    expect(response.body.path).toBe('/tidak-ada');
    expect(JSON.stringify(response.body)).not.toContain('rahasia@example.com');
    expect(JSON.stringify(response.body)).not.toContain('token=abc');
  });
});
