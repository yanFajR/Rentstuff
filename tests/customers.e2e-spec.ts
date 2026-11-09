import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { registerTestUser, testPrisma } from './utils/auth.js';
import { extractCsrfToken, uniqueEmail } from './utils/cookies.js';
import { createCustomer } from './utils/domain.js';
import { createTestApplication } from './utils/create-app.js';

describe('Customer management (e2e)', () => {
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

  it('menolak akses tanpa login', async () => {
    await request(server).get('/customers').expect(302).expect('Location', '/login');
    await request(server).get('/customers/new').expect(302).expect('Location', '/login');
  });

  it('menambahkan pelanggan dengan normalisasi nomor dan email', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Pelanggan' });
    const created = await createCustomer(owner.agent, {
      name: '  Siti Aminah  ',
      whatsappNumber: '0812-3456-7890',
      email: '  SITI@Example.COM ',
      address: 'Jl. Merdeka 1',
      notes: 'Pelanggan baru',
    });

    const customer = await testPrisma.customer.findUniqueOrThrow({ where: { id: created.id } });

    expect(customer.businessId).toBe(owner.businessId);
    expect(customer.name).toBe('Siti Aminah');
    expect(customer.whatsappNumber).toBe('6281234567890');
    expect(customer.email).toBe('siti@example.com');
    expect(customer.archivedAt).toBeNull();

    const detail = await owner.agent.get(`/customers/${created.id}`).expect(200);
    expect(detail.text).toContain('Siti Aminah');
    expect(detail.text).toContain('6281234567890');
    expect(detail.text).toContain('Jl. Merdeka 1');
    expect(detail.text).toContain('Pelanggan berhasil ditambahkan.');
  });

  it('menolak input pelanggan yang tidak valid', async () => {
    const owner = await registerTestUser(server);
    const page = await owner.agent.get('/customers/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);

    const response = await owner.agent
      .post('/customers')
      .type('form')
      .send({
        _csrf: csrfToken,
        name: '',
        whatsappNumber: '',
        email: 'bukan-email',
      })
      .expect(422);

    expect(response.text).toContain('Nama pelanggan');
    expect(response.text).toContain('Nomor WhatsApp');
    expect(response.text).toContain('Format email tidak valid');

    const count = await testPrisma.customer.count({ where: { businessId: owner.businessId } });
    expect(count).toBe(0);
  });

  it('mengedit pelanggan dan mempertahankan data bisnis lain', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Edit Pelanggan' });
    const other = await registerTestUser(server, { businessName: 'Rental Lain' });
    const created = await createCustomer(owner.agent, {
      name: 'Nama Awal',
      whatsappNumber: '081211112222',
    });
    const otherCustomer = await createCustomer(other.agent, {
      name: 'Pelanggan Lain',
      whatsappNumber: '081233334444',
    });

    const editPage = await owner.agent.get(`/customers/${created.id}/edit`).expect(200);
    const csrfToken = extractCsrfToken(editPage.text);

    await owner.agent
      .post(`/customers/${created.id}`)
      .type('form')
      .send({
        _csrf: csrfToken,
        name: 'Nama Diperbarui',
        whatsappNumber: '081255556666',
        email: 'baru@example.com',
        address: 'Alamat baru',
        notes: 'Catatan baru',
      })
      .expect(303);

    const updated = await testPrisma.customer.findUniqueOrThrow({ where: { id: created.id } });
    const untouched = await testPrisma.customer.findUniqueOrThrow({
      where: { id: otherCustomer.id },
    });

    expect(updated.name).toBe('Nama Diperbarui');
    expect(updated.whatsappNumber).toBe('6281255556666');
    expect(untouched.name).toBe('Pelanggan Lain');
  });

  it('mencari pelanggan berdasarkan nama dan nomor WhatsApp', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Pencarian' });
    await createCustomer(owner.agent, { name: 'Alpha Rental', whatsappNumber: '081211110001' });
    await createCustomer(owner.agent, { name: 'Beta Rental', whatsappNumber: '081211110002' });

    const byName = await owner.agent.get('/customers?q=Alpha').expect(200);
    expect(byName.text).toContain('Alpha Rental');
    expect(byName.text).not.toContain('Beta Rental');

    const byPhone = await owner.agent.get('/customers?q=081211110002').expect(200);
    expect(byPhone.text).toContain('Beta Rental');
    expect(byPhone.text).not.toContain('Alpha Rental');
  });

  it('menampilkan pagination pelanggan', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Pagination' });
    const now = Date.now();

    await testPrisma.customer.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        businessId: owner.businessId,
        name: `Pelanggan ${String(index + 1).padStart(2, '0')}`,
        whatsappNumber: `62812000${String(index + 1).padStart(4, '0')}`,
        createdAt: new Date(now - index * 1_000),
      })),
    });

    const firstPage = await owner.agent.get('/customers').expect(200);
    expect(firstPage.text).toContain('Menampilkan');

    const secondPage = await owner.agent.get('/customers?page=2').expect(200);
    expect(secondPage.text).toContain('Pelanggan 11');
    expect(secondPage.text).toContain('Pelanggan 12');
    expect(secondPage.text).not.toContain('Pelanggan 01');
  });

  it('mengarsipkan pelanggan tanpa menghapus riwayat transaksi', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Arsip' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan Arsip',
      whatsappNumber: '081277778888',
    });
    const rentalPage = await owner.agent.get('/rentals/new').expect(200);
    const rentalCsrf = extractCsrfToken(rentalPage.text);

    await owner.agent
      .post('/rentals')
      .type('form')
      .send({
        _csrf: rentalCsrf,
        customerId: customer.id,
        itemName: 'Kamera Canon',
        startDate: '2026-11-08',
        endDate: '2026-11-10',
        price: '500000',
        notes: '',
      })
      .expect(303);

    const detail = await owner.agent.get(`/customers/${customer.id}`).expect(200);
    const archiveCsrf = extractCsrfToken(detail.text);

    await owner.agent
      .post(`/customers/${customer.id}/archive`)
      .type('form')
      .send({ _csrf: archiveCsrf })
      .expect(303);

    const archived = await testPrisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(archived).not.toBeNull();
    expect(archived.archivedAt).toBeInstanceOf(Date);

    const rentals = await testPrisma.rentalRecord.count({
      where: { businessId: owner.businessId, customerId: customer.id },
    });
    expect(rentals).toBe(1);

    const archivedPage = await owner.agent.get(`/customers/${customer.id}`).expect(200);
    expect(archivedPage.text).toContain('Diarsipkan');
    expect(archivedPage.text).toContain('Kamera Canon');

    const newRentalPage = await owner.agent.get('/rentals/new').expect(200);
    expect(newRentalPage.text).not.toContain('Pelanggan Arsip');

    const restoreCsrf = extractCsrfToken(archivedPage.text);
    await owner.agent
      .post(`/customers/${customer.id}/restore`)
      .type('form')
      .send({ _csrf: restoreCsrf })
      .expect(303);

    const restored = await testPrisma.customer.findUniqueOrThrow({ where: { id: customer.id } });
    expect(restored.archivedAt).toBeNull();
  });

  it('tidak mengakses atau mengubah pelanggan bisnis lain', async () => {
    const ownerA = await registerTestUser(server, { businessName: 'Rental A' });
    const ownerB = await registerTestUser(server, { businessName: 'Rental B' });
    const customerA = await createCustomer(ownerA.agent, {
      name: 'Rahasia A',
      whatsappNumber: '081299990001',
    });

    await ownerB.agent.get(`/customers/${customerA.id}`).expect(404);
    await ownerB.agent.get(`/customers/${customerA.id}/edit`).expect(404);

    const page = await ownerB.agent.get('/customers/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);
    await ownerB.agent
      .post(`/customers/${customerA.id}`)
      .type('form')
      .send({ _csrf: csrfToken, name: 'Dibajak', whatsappNumber: '081200000001' })
      .expect(404);

    await ownerB.agent
      .post(`/customers/${customerA.id}/archive`)
      .type('form')
      .send({ _csrf: csrfToken })
      .expect(404);

    const unchanged = await testPrisma.customer.findUniqueOrThrow({
      where: { id: customerA.id },
    });
    expect(unchanged.name).toBe('Rahasia A');
    expect(unchanged.archivedAt).toBeNull();
  });

  it('menolak businessId yang dikirim dari request', async () => {
    const owner = await registerTestUser(server);
    const page = await owner.agent.get('/customers/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);

    await owner.agent
      .post('/customers')
      .type('form')
      .send({
        _csrf: csrfToken,
        businessId: 'business-lain',
        name: 'Manipulasi',
        whatsappNumber: '081211119999',
      })
      .expect(403);

    await owner.agent.get('/customers?businessId=lain').expect(403);
  });

  it('menampilkan email pelanggan yang unik antar bisnis', async () => {
    const ownerA = await registerTestUser(server, { businessName: 'Rental Email A' });
    const ownerB = await registerTestUser(server, { businessName: 'Rental Email B' });
    const email = uniqueEmail('sama');

    const customerA = await createCustomer(ownerA.agent, {
      name: 'Pelanggan A',
      whatsappNumber: '081211112220',
      email,
    });
    const customerB = await createCustomer(ownerB.agent, {
      name: 'Pelanggan B',
      whatsappNumber: '081211112221',
      email,
    });

    expect(customerA.id).not.toBe(customerB.id);
    expect(await testPrisma.customer.count({ where: { email } })).toBe(2);
  });
});
