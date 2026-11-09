import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { registerTestUser, testPrisma } from './utils/auth.js';
import { extractCsrfToken } from './utils/cookies.js';
import { createCustomer, createRental } from './utils/domain.js';
import { createTestApplication } from './utils/create-app.js';

describe('Rental management (e2e)', () => {
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
    await request(server).get('/rentals').expect(302).expect('Location', '/login');
    await request(server).get('/rentals/new').expect(302).expect('Location', '/login');
  });

  it('membuat transaksi dengan nomor otomatis dan status ACTIVE', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Transaksi' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan Transaksi',
      whatsappNumber: '081234567001',
    });

    const created = await createRental(owner.agent, {
      customerId: customer.id,
      itemName: 'Toyota Avanza 2022',
      startDate: '2026-11-08',
      endDate: '2026-11-10',
      price: '1.500.000',
      notes: 'Termasuk sopir',
    });

    const rental = await testPrisma.rentalRecord.findUniqueOrThrow({ where: { id: created.id } });

    expect(rental.businessId).toBe(owner.businessId);
    expect(rental.customerId).toBe(customer.id);
    expect(rental.rentalNumber).toBe('RNT-00001');
    expect(rental.status).toBe('ACTIVE');
    expect(rental.price).toBe(1_500_000);
    expect(rental.itemName).toBe('Toyota Avanza 2022');
    expect(rental.startDate.toISOString()).toBe('2026-11-08T00:00:00.000Z');

    const detail = await owner.agent.get(`/rentals/${created.id}`).expect(200);
    expect(detail.text).toContain('RNT-00001');
    expect(detail.text).toContain('Toyota Avanza 2022');
    expect(detail.text).toContain('Rp1.500.000');
    expect(detail.text).toContain('Pelanggan Transaksi');
    expect(detail.text).toContain('Penyewaan berhasil dibuat.');
    expect(detail.text).toContain('Tandai selesai');
  });

  it('menolak tanggal selesai sebelum tanggal mulai', async () => {
    const owner = await registerTestUser(server);
    const customer = await createCustomer(owner.agent);
    const page = await owner.agent.get('/rentals/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);

    const response = await owner.agent
      .post('/rentals')
      .type('form')
      .send({
        _csrf: csrfToken,
        customerId: customer.id,
        itemName: 'Kamera',
        startDate: '2026-11-10',
        endDate: '2026-11-08',
        price: '100000',
      })
      .expect(422);

    expect(response.text).toContain('Tanggal selesai tidak boleh sebelum tanggal mulai');
    expect(await testPrisma.rentalRecord.count({ where: { businessId: owner.businessId } })).toBe(
      0,
    );
  });

  it('menolak tanggal yang tidak valid di kalender', async () => {
    const owner = await registerTestUser(server);
    const customer = await createCustomer(owner.agent);
    const page = await owner.agent.get('/rentals/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);

    const response = await owner.agent
      .post('/rentals')
      .type('form')
      .send({
        _csrf: csrfToken,
        customerId: customer.id,
        itemName: 'Kamera',
        startDate: '2026-02-31',
        endDate: '2026-03-02',
        price: '100000',
      })
      .expect(422);

    expect(response.text).toContain('Tanggal mulai tidak valid');
  });

  it('menolak harga negatif, desimal, dan kosong', async () => {
    const owner = await registerTestUser(server);
    const customer = await createCustomer(owner.agent);
    const page = await owner.agent.get('/rentals/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);

    const basePayload = {
      _csrf: csrfToken,
      customerId: customer.id,
      itemName: 'Kamera',
      startDate: '2026-11-08',
      endDate: '2026-11-10',
    };

    const negative = await owner.agent
      .post('/rentals')
      .type('form')
      .send({ ...basePayload, price: '-500' })
      .expect(422);
    expect(negative.text).toContain('Harga sewa');

    const decimal = await owner.agent
      .post('/rentals')
      .type('form')
      .send({ ...basePayload, price: '12.5' })
      .expect(422);
    expect(decimal.text).toContain('Harga sewa');

    const empty = await owner.agent
      .post('/rentals')
      .type('form')
      .send({ ...basePayload, price: '' })
      .expect(422);
    expect(empty.text).toContain('Harga sewa');

    expect(await testPrisma.rentalRecord.count({ where: { businessId: owner.businessId } })).toBe(
      0,
    );
  });

  it('membuat nomor transaksi yang unik dan berurutan per bisnis', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Nomor' });
    const customer = await createCustomer(owner.agent);

    const first = await createRental(owner.agent, { customerId: customer.id });
    const second = await createRental(owner.agent, {
      customerId: customer.id,
      itemName: 'Kamera Sony',
    });
    const third = await createRental(owner.agent, {
      customerId: customer.id,
      itemName: 'Tenda Event',
    });

    const numbers = await testPrisma.rentalRecord.findMany({
      where: { id: { in: [first.id, second.id, third.id] } },
      orderBy: { rentalNumber: 'asc' },
      select: { rentalNumber: true },
    });

    expect(numbers.map((item) => item.rentalNumber)).toEqual([
      'RNT-00001',
      'RNT-00002',
      'RNT-00003',
    ]);
  });

  it('memperbarui transaksi aktif', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Edit' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });

    const detail = await owner.agent.get(`/rentals/${rental.id}`).expect(200);
    const csrfToken = extractCsrfToken(detail.text);

    await owner.agent
      .post(`/rentals/${rental.id}`)
      .type('form')
      .send({
        _csrf: csrfToken,
        customerId: customer.id,
        itemName: 'Toyota Innova 2023',
        startDate: '2026-11-09',
        endDate: '2026-11-12',
        price: '2.000.000',
        notes: 'Diperbarui',
      })
      .expect(303);

    const updated = await testPrisma.rentalRecord.findUniqueOrThrow({
      where: { id: rental.id },
    });
    expect(updated.itemName).toBe('Toyota Innova 2023');
    expect(updated.price).toBe(2_000_000);
    expect(updated.notes).toBe('Diperbarui');
  });

  it('menandai transaksi selesai dan menolak transisi status yang tidak valid', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Status' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });

    const detail = await owner.agent.get(`/rentals/${rental.id}`).expect(200);
    const csrfToken = extractCsrfToken(detail.text);

    await owner.agent
      .post(`/rentals/${rental.id}/complete`)
      .type('form')
      .send({ _csrf: csrfToken })
      .expect(303);

    const completed = await testPrisma.rentalRecord.findUniqueOrThrow({
      where: { id: rental.id },
    });
    expect(completed.status).toBe('COMPLETED');

    const completedPage = await owner.agent.get(`/rentals/${rental.id}`).expect(200);
    const completedCsrf = extractCsrfToken(completedPage.text);

    await owner.agent
      .post(`/rentals/${rental.id}/complete`)
      .type('form')
      .send({ _csrf: completedCsrf })
      .expect(303);

    const invalidTransition = await owner.agent.get(`/rentals/${rental.id}`).expect(200);
    expect(invalidTransition.text).toContain('Perubahan status transaksi tidak valid');

    await owner.agent
      .post(`/rentals/${rental.id}`)
      .type('form')
      .send({
        _csrf: completedCsrf,
        customerId: customer.id,
        itemName: 'Tidak boleh berubah',
        startDate: '2026-11-08',
        endDate: '2026-11-10',
        price: '999999',
      })
      .expect(303);

    const unchanged = await testPrisma.rentalRecord.findUniqueOrThrow({ where: { id: rental.id } });
    expect(unchanged.itemName).toBe('Toyota Avanza 2022');
    expect(unchanged.status).toBe('COMPLETED');

    const editPage = await owner.agent.get(`/rentals/${rental.id}/edit`).expect(303);
    expect(editPage.headers.location).toBe(`/rentals/${rental.id}`);
  });

  it('membatalkan transaksi aktif', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Batal' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });

    const detail = await owner.agent.get(`/rentals/${rental.id}`).expect(200);
    const csrfToken = extractCsrfToken(detail.text);

    await owner.agent
      .post(`/rentals/${rental.id}/cancel`)
      .type('form')
      .send({ _csrf: csrfToken })
      .expect(303);

    const cancelled = await testPrisma.rentalRecord.findUniqueOrThrow({
      where: { id: rental.id },
    });
    expect(cancelled.status).toBe('CANCELLED');

    const page = await owner.agent.get(`/rentals/${rental.id}`).expect(200);
    expect(page.text).toContain('Dibatalkan');
    expect(page.text).toContain('Transaksi berhasil dibatalkan.');
  });

  it('menolak pelanggan milik bisnis lain saat membuat transaksi', async () => {
    const ownerA = await registerTestUser(server, { businessName: 'Rental A' });
    const ownerB = await registerTestUser(server, { businessName: 'Rental B' });
    const customerA = await createCustomer(ownerA.agent, {
      name: 'Pelanggan A',
      whatsappNumber: '081233330001',
    });

    const page = await ownerB.agent.get('/rentals/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);

    const response = await ownerB.agent
      .post('/rentals')
      .type('form')
      .send({
        _csrf: csrfToken,
        customerId: customerA.id,
        itemName: 'Barang B',
        startDate: '2026-11-08',
        endDate: '2026-11-10',
        price: '100000',
      })
      .expect(422);

    expect(response.text).toContain('Pelanggan tidak ditemukan');
    expect(await testPrisma.rentalRecord.count({ where: { businessId: ownerB.businessId } })).toBe(
      0,
    );
  });

  it('menolak pelanggan yang sudah diarsipkan', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Arsip' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan Arsip',
      whatsappNumber: '081233330002',
    });

    const detail = await owner.agent.get(`/customers/${customer.id}`).expect(200);
    const archiveCsrf = extractCsrfToken(detail.text);
    await owner.agent
      .post(`/customers/${customer.id}/archive`)
      .type('form')
      .send({ _csrf: archiveCsrf })
      .expect(303);

    const page = await owner.agent.get('/rentals/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);

    const response = await owner.agent
      .post('/rentals')
      .type('form')
      .send({
        _csrf: csrfToken,
        customerId: customer.id,
        itemName: 'Barang',
        startDate: '2026-11-08',
        endDate: '2026-11-10',
        price: '100000',
      })
      .expect(422);

    expect(response.text).toContain('Pelanggan tidak ditemukan');
  });

  it('menambahkan pelanggan cepat melalui HTMX dan memilihnya otomatis', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Quick Add' });
    const rentalPage = await owner.agent.get('/rentals/new').expect(200);
    const csrfToken = extractCsrfToken(rentalPage.text);

    const response = await owner.agent
      .post('/customers/quick-add')
      .set('HX-Request', 'true')
      .type('form')
      .send({
        _csrf: csrfToken,
        name: 'Pelanggan Cepat',
        whatsappNumber: '081233330003',
        email: '',
      })
      .expect(200);

    expect(response.text).toContain('hx-swap-oob');
    expect(response.text).toContain('Pelanggan Cepat');
    expect(response.text).toContain('selected');

    const customer = await testPrisma.customer.findFirstOrThrow({
      where: { businessId: owner.businessId, name: 'Pelanggan Cepat' },
    });
    expect(customer.whatsappNumber).toBe('6281233330003');
  });

  it('memfilter transaksi berdasarkan status, pencarian, dan rentang tanggal', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Filter' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan Filter',
      whatsappNumber: '081233330004',
    });

    const active = await createRental(owner.agent, {
      customerId: customer.id,
      itemName: 'Kamera Filter',
      startDate: '2026-11-01',
      endDate: '2026-11-02',
    });
    const completed = await createRental(owner.agent, {
      customerId: customer.id,
      itemName: 'Tenda Filter',
      startDate: '2026-12-01',
      endDate: '2026-12-02',
    });

    const detail = await owner.agent.get(`/rentals/${completed.id}`).expect(200);
    const csrfToken = extractCsrfToken(detail.text);
    await owner.agent
      .post(`/rentals/${completed.id}/complete`)
      .type('form')
      .send({ _csrf: csrfToken })
      .expect(303);

    const byStatus = await owner.agent.get('/rentals?status=COMPLETED').expect(200);
    expect(byStatus.text).toContain('Tenda Filter');
    expect(byStatus.text).not.toContain('Kamera Filter');

    const bySearch = await owner.agent.get('/rentals?q=Pelanggan+Filter').expect(200);
    expect(bySearch.text).toContain('Tenda Filter');
    expect(bySearch.text).toContain('Kamera Filter');

    const byDate = await owner.agent.get('/rentals?from=2026-12-01&to=2026-12-31').expect(200);
    expect(byDate.text).toContain('Tenda Filter');
    expect(byDate.text).not.toContain('Kamera Filter');

    const activePage = await owner.agent.get(`/rentals/${active.id}`).expect(200);
    expect(activePage.text).toContain('Kamera Filter');
  });

  it('menampilkan pagination transaksi', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Pagination' });
    const customer = await createCustomer(owner.agent);
    const now = Date.now();

    await testPrisma.rentalRecord.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        businessId: owner.businessId,
        customerId: customer.id,
        rentalNumber: `RNT-SEED-${String(index + 1).padStart(2, '0')}`,
        itemName: `Barang ${index + 1}`,
        startDate: new Date('2026-11-08T00:00:00.000Z'),
        endDate: new Date('2026-11-10T00:00:00.000Z'),
        price: 100_000,
        status: 'ACTIVE',
        createdAt: new Date(now - index * 1_000),
      })),
    });

    const secondPage = await owner.agent.get('/rentals?page=2').expect(200);
    expect(secondPage.text).toContain('Menampilkan');
    expect(secondPage.text).toContain('RNT-SEED-11');
    expect(secondPage.text).toContain('RNT-SEED-12');
    expect(secondPage.text).not.toContain('RNT-SEED-01');
  });

  it('tidak mengakses atau mengubah transaksi bisnis lain', async () => {
    const ownerA = await registerTestUser(server, { businessName: 'Rental A' });
    const ownerB = await registerTestUser(server, { businessName: 'Rental B' });
    const customerA = await createCustomer(ownerA.agent, {
      name: 'Pelanggan A',
      whatsappNumber: '081233330005',
    });
    const rentalA = await createRental(ownerA.agent, {
      customerId: customerA.id,
      itemName: 'Barang Rahasia A',
    });

    await ownerB.agent.get(`/rentals/${rentalA.id}`).expect(404);
    await ownerB.agent.get(`/rentals/${rentalA.id}/edit`).expect(404);

    const ownCustomer = await createCustomer(ownerB.agent, {
      name: 'Pelanggan B',
      whatsappNumber: '081233330006',
    });
    const page = await ownerB.agent.get('/rentals/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);

    await ownerB.agent
      .post(`/rentals/${rentalA.id}`)
      .type('form')
      .send({
        _csrf: csrfToken,
        customerId: ownCustomer.id,
        itemName: 'Dibajak',
        startDate: '2026-11-08',
        endDate: '2026-11-10',
        price: '1000',
      })
      .expect(404);

    await ownerB.agent
      .post(`/rentals/${rentalA.id}/complete`)
      .type('form')
      .send({ _csrf: csrfToken })
      .expect(404);

    const unchanged = await testPrisma.rentalRecord.findUniqueOrThrow({
      where: { id: rentalA.id },
    });
    expect(unchanged.itemName).toBe('Barang Rahasia A');
    expect(unchanged.status).toBe('ACTIVE');

    const list = await ownerB.agent.get('/rentals').expect(200);
    expect(list.text).not.toContain('Barang Rahasia A');
  });

  it('menolak businessId yang dikirim dari request', async () => {
    const owner = await registerTestUser(server);
    const customer = await createCustomer(owner.agent);
    const page = await owner.agent.get('/rentals/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);

    await owner.agent
      .post('/rentals')
      .type('form')
      .send({
        _csrf: csrfToken,
        businessId: 'business-lain',
        customerId: customer.id,
        itemName: 'Manipulasi',
        startDate: '2026-11-08',
        endDate: '2026-11-10',
        price: '1000',
      })
      .expect(403);

    await owner.agent.get('/rentals?businessId=lain').expect(403);
  });
});
