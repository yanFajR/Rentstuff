import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { registerTestUser, testPrisma } from './utils/auth.js';
import { extractCsrfToken } from './utils/cookies.js';
import { createTestApplication } from './utils/create-app.js';

describe('Isolasi tenant (e2e)', () => {
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

  it('hanya menampilkan data bisnis milik user yang sedang login', async () => {
    const ownerA = await registerTestUser(server, {
      name: 'Pemilik A',
      businessName: 'Rental Alpha',
    });
    const ownerB = await registerTestUser(server, {
      name: 'Pemilik B',
      businessName: 'Rental Beta',
    });

    const response = await ownerB.agent.get('/settings').expect(200);

    expect(response.text).toContain('Rental Beta');
    expect(response.text).toContain(ownerB.email);
    expect(response.text).not.toContain('Rental Alpha');
    expect(response.text).not.toContain(ownerA.email);
  });

  it('menolak request dengan business_id palsu dan tidak mengubah data apa pun', async () => {
    const ownerA = await registerTestUser(server, {
      name: 'Pemilik A',
      businessName: 'Rental Alpha',
    });
    const ownerB = await registerTestUser(server, {
      name: 'Pemilik B',
      businessName: 'Rental Beta',
    });

    const settings = await ownerB.agent.get('/settings').expect(200);
    const csrfToken = extractCsrfToken(settings.text);

    const response = await ownerB.agent
      .post('/settings/business')
      .type('form')
      .send({
        _csrf: csrfToken,
        businessId: ownerA.businessId,
        businessName: 'Rental Beta Baru',
        ownerName: 'Pemilik B Baru',
        whatsappNumber: '0812-1111-2222',
        address: 'Jl. Beta No. 2',
        description: 'Rental perlengkapan event',
      })
      .expect(403);

    expect(response.text).toContain('Parameter businessId dari request tidak diizinkan');

    const businessA = await testPrisma.business.findUniqueOrThrow({
      where: { id: ownerA.businessId },
    });
    const businessB = await testPrisma.business.findUniqueOrThrow({
      where: { id: ownerB.businessId },
    });
    const userA = await testPrisma.user.findUniqueOrThrow({ where: { id: ownerA.userId } });
    const userB = await testPrisma.user.findUniqueOrThrow({ where: { id: ownerB.userId } });

    expect(businessA.name).toBe('Rental Alpha');
    expect(businessA.whatsappNumber).toBeNull();
    expect(businessB.name).toBe('Rental Beta');
    expect(userA.name).toBe('Pemilik A');
    expect(userB.name).toBe('Pemilik B');
  });

  it('menolak business_id pada query string saat membuka pengaturan', async () => {
    const ownerA = await registerTestUser(server, { businessName: 'Rental Alpha' });
    const ownerB = await registerTestUser(server, { businessName: 'Rental Beta' });

    const response = await ownerB.agent
      .get(`/settings?businessId=${ownerA.businessId}`)
      .expect(403);

    expect(response.text).toContain('Parameter businessId dari request tidak diizinkan');
  });

  it('menyimpan perubahan profil bisnis dan menampilkan pesan sukses', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Sebelum' });
    const settings = await owner.agent.get('/settings').expect(200);
    const csrfToken = extractCsrfToken(settings.text);

    const update = await owner.agent
      .post('/settings/business')
      .type('form')
      .send({
        _csrf: csrfToken,
        businessName: 'Rental Sesudah',
        ownerName: 'Nama Pemilik Baru',
        whatsappNumber: '081298765432',
        address: 'Jl. Baru No. 10',
        description: 'Rental kamera dan lensa',
      })
      .expect(303);

    expect(update.headers.location).toBe('/settings');

    const updatedPage = await owner.agent.get('/settings').expect(200);
    expect(updatedPage.text).toContain('Profil bisnis berhasil disimpan.');
    expect(updatedPage.text).toContain('Rental Sesudah');
    expect(updatedPage.text).toContain('Jl. Baru No. 10');
    expect(updatedPage.text).toContain('Rental kamera dan lensa');
  });

  it('menampilkan error validasi tanpa mengubah data', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Validasi' });
    const settings = await owner.agent.get('/settings').expect(200);
    const csrfToken = extractCsrfToken(settings.text);

    const response = await owner.agent
      .post('/settings/business')
      .type('form')
      .send({
        _csrf: csrfToken,
        businessName: '',
        ownerName: '',
        whatsappNumber: '12345',
      })
      .expect(422);

    expect(response.text).toContain('Nama bisnis');
    expect(response.text).toContain('Nama pemilik');
    expect(response.text).toContain('Nomor WhatsApp tidak valid');

    const business = await testPrisma.business.findUniqueOrThrow({
      where: { id: owner.businessId },
    });
    expect(business.name).toBe('Rental Validasi');
  });

  it('menolak akses pengaturan dengan cookie sesi yang tidak valid', async () => {
    const response = await request(server)
      .get('/settings')
      .set('Cookie', 'rental_reminder.sid=sesi-palsu');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/login');
  });
});
