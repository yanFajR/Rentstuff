import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { registerTestUser, testPrisma } from './utils/auth.js';
import { extractCsrfToken } from './utils/cookies.js';
import { createCustomer, createInvoice, createPayment, createRental } from './utils/domain.js';
import { createTestApplication } from './utils/create-app.js';

describe('Invoice management (e2e)', () => {
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
    await request(server).get('/invoices').expect(302).expect('Location', '/login');
    await request(server).get('/invoices/new').expect(302).expect('Location', '/login');
    await request(server).get('/payments').expect(302).expect('Location', '/login');
  });

  it('membuat invoice dari rental dengan snapshot dan nomor otomatis', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Invoice' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan Invoice',
      whatsappNumber: '081255550001',
    });
    const rental = await createRental(owner.agent, {
      customerId: customer.id,
      itemName: 'Toyota Avanza',
      price: '1.500.000',
    });

    const newPage = await owner.agent.get(`/invoices/new?rentalId=${rental.id}`).expect(200);
    expect(newPage.text).toContain('value="1500000"');
    expect(newPage.text).toContain('Pelanggan Invoice');
    expect(newPage.text).toContain('Toyota Avanza');

    const summary = await owner.agent
      .get(`/invoices/rental-summary?rentalRecordId=${rental.id}`)
      .expect(200);
    expect(summary.text).toContain('hx-swap-oob="true"');
    expect(summary.text).toContain('value="1500000"');

    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: '2026-11-08',
      dueDate: '2026-11-15',
      totalAmount: '1.500.000',
      description: 'Tagihan sewa Avanza',
    });

    const stored = await testPrisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(stored.businessId).toBe(owner.businessId);
    expect(stored.rentalRecordId).toBe(rental.id);
    expect(stored.invoiceNumber).toBe('INV-00001');
    expect(stored.totalAmount).toBe(1_500_000);
    expect(stored.cancelledAt).toBeNull();
    expect(stored.issueDate.toISOString()).toBe('2026-11-08T00:00:00.000Z');
    expect(stored.dueDate.toISOString()).toBe('2026-11-15T00:00:00.000Z');

    const detail = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    expect(detail.text).toContain('INV-00001');
    expect(detail.text).toContain('Belum dibayar');
    expect(detail.text).toContain('Rp1.500.000');
    expect(detail.text).toContain('Pelanggan Invoice');
    expect(detail.text).toContain('Toyota Avanza');
    expect(detail.text).toContain('Rental Invoice');
  });

  it('membuat nomor invoice unik dan berurutan per business', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Nomor Invoice' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });

    await createInvoice(owner.agent, { rentalRecordId: rental.id, totalAmount: '100000' });
    await createInvoice(owner.agent, { rentalRecordId: rental.id, totalAmount: '200000' });
    await createInvoice(owner.agent, { rentalRecordId: rental.id, totalAmount: '300000' });

    const invoices = await testPrisma.invoice.findMany({
      where: { businessId: owner.businessId },
      orderBy: { invoiceNumber: 'asc' },
      select: { invoiceNumber: true },
    });

    expect(invoices.map((invoice) => invoice.invoiceNumber)).toEqual([
      'INV-00001',
      'INV-00002',
      'INV-00003',
    ]);
  });

  it('mengizinkan nomor invoice yang sama pada business berbeda', async () => {
    const ownerA = await registerTestUser(server, { businessName: 'Rental Nomor A' });
    const ownerB = await registerTestUser(server, { businessName: 'Rental Nomor B' });
    const customerA = await createCustomer(ownerA.agent);
    const customerB = await createCustomer(ownerB.agent);
    const rentalA = await createRental(ownerA.agent, { customerId: customerA.id });
    const rentalB = await createRental(ownerB.agent, { customerId: customerB.id });

    const invoiceA = await createInvoice(ownerA.agent, { rentalRecordId: rentalA.id });
    const invoiceB = await createInvoice(ownerB.agent, { rentalRecordId: rentalB.id });

    const storedA = await testPrisma.invoice.findUniqueOrThrow({ where: { id: invoiceA.id } });
    const storedB = await testPrisma.invoice.findUniqueOrThrow({ where: { id: invoiceB.id } });

    expect(storedA.invoiceNumber).toBe('INV-00001');
    expect(storedB.invoiceNumber).toBe('INV-00001');
    expect(storedA.businessId).not.toBe(storedB.businessId);
  });

  it('menampilkan tagihan pada detail pelanggan dan detail rental', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Integrasi' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan Integrasi',
      whatsappNumber: '081255550050',
    });
    const rental = await createRental(owner.agent, {
      customerId: customer.id,
      price: '1.000.000',
    });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '1.000.000',
      dueDate: '2099-12-31',
    });
    await createPayment(owner.agent, invoice.id, { amount: '300.000' });

    const customerPage = await owner.agent.get(`/customers/${customer.id}`).expect(200);
    expect(customerPage.text).toContain('Tagihan & piutang');
    expect(customerPage.text).toContain(invoice.id);
    expect(customerPage.text).toContain('Sisa piutang');
    expect(customerPage.text).toContain('Rp700.000');
    expect(customerPage.text).toContain('Dibayar sebagian');

    const rentalPage = await owner.agent.get(`/rentals/${rental.id}`).expect(200);
    expect(rentalPage.text).toContain('Tagihan & pembayaran');
    expect(rentalPage.text).toContain(invoice.id);
    expect(rentalPage.text).toContain('Total ditagihkan');
    expect(rentalPage.text).toContain('Rp700.000');
    expect(rentalPage.text).toContain('Dibayar sebagian');
  });

  it('memvalidasi tanggal, nominal, dan rental', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Validasi Invoice' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const page = await owner.agent.get('/invoices/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);

    const base = {
      _csrf: csrfToken,
      rentalRecordId: rental.id,
      issueDate: '2026-11-10',
      dueDate: '2026-11-15',
      totalAmount: '1000000',
    };

    const dueBefore = await owner.agent
      .post('/invoices')
      .type('form')
      .send({ ...base, dueDate: '2026-11-08' })
      .expect(422);
    expect(dueBefore.text).toContain('Tanggal jatuh tempo tidak boleh sebelum tanggal penerbitan');

    for (const total of ['0', '-1000', '12.5', '']) {
      const response = await owner.agent
        .post('/invoices')
        .type('form')
        .send({ ...base, totalAmount: total })
        .expect(422);
      expect(response.text).toContain('Total tagihan');
    }

    const invalidDate = await owner.agent
      .post('/invoices')
      .type('form')
      .send({ ...base, dueDate: '2026-02-31' })
      .expect(422);
    expect(invalidDate.text).toContain('Tanggal jatuh tempo tidak valid');

    expect(await testPrisma.invoice.count({ where: { businessId: owner.businessId } })).toBe(0);
  });

  it('menolak rental yang dibatalkan atau milik bisnis lain', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Batal Invoice' });
    const other = await registerTestUser(server, { businessName: 'Rental Lain' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });

    const rentalDetail = await owner.agent.get(`/rentals/${rental.id}`).expect(200);
    const rentalCsrf = extractCsrfToken(rentalDetail.text);
    await owner.agent
      .post(`/rentals/${rental.id}/cancel`)
      .type('form')
      .send({ _csrf: rentalCsrf })
      .expect(303);

    const page = await owner.agent.get('/invoices/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);

    const cancelled = await owner.agent
      .post('/invoices')
      .type('form')
      .send({
        _csrf: csrfToken,
        rentalRecordId: rental.id,
        issueDate: '2026-11-08',
        dueDate: '2026-11-15',
        totalAmount: '1000000',
      })
      .expect(422);
    expect(cancelled.text).toContain('dibatalkan');

    const otherCustomer = await createCustomer(other.agent);
    const otherRental = await createRental(other.agent, { customerId: otherCustomer.id });
    const otherPage = await owner.agent.get('/invoices/new').expect(200);
    const otherCsrf = extractCsrfToken(otherPage.text);

    const crossTenant = await owner.agent
      .post('/invoices')
      .type('form')
      .send({
        _csrf: otherCsrf,
        rentalRecordId: otherRental.id,
        issueDate: '2026-11-08',
        dueDate: '2026-11-15',
        totalAmount: '1000000',
      })
      .expect(422);
    expect(crossTenant.text).toContain('tidak ditemukan');
  });

  it('menjaga snapshot total saat harga rental diubah', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Snapshot' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, {
      customerId: customer.id,
      price: '1.500.000',
    });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '1.500.000',
    });

    const rentalDetail = await owner.agent.get(`/rentals/${rental.id}`).expect(200);
    const rentalCsrf = extractCsrfToken(rentalDetail.text);
    await owner.agent
      .post(`/rentals/${rental.id}`)
      .type('form')
      .send({
        _csrf: rentalCsrf,
        customerId: customer.id,
        itemName: 'Toyota Avanza Baru',
        startDate: '2026-11-08',
        endDate: '2026-11-10',
        price: '2.000.000',
        notes: '',
      })
      .expect(303);

    const updatedRental = await testPrisma.rentalRecord.findUniqueOrThrow({
      where: { id: rental.id },
    });
    const storedInvoice = await testPrisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });

    expect(updatedRental.price).toBe(2_000_000);
    expect(storedInvoice.totalAmount).toBe(1_500_000);

    const detail = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    expect(detail.text).toContain('Rp1.500.000');
  });

  it('mengedit invoice yang belum memiliki pembayaran', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Edit Invoice' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '1000000',
    });

    const editPage = await owner.agent.get(`/invoices/${invoice.id}/edit`).expect(200);
    const csrfToken = extractCsrfToken(editPage.text);

    await owner.agent
      .post(`/invoices/${invoice.id}`)
      .type('form')
      .send({
        _csrf: csrfToken,
        issueDate: '2026-11-09',
        dueDate: '2026-11-20',
        totalAmount: '1.200.000',
        description: 'Total diperbarui',
        notes: 'Catatan baru',
      })
      .expect(303);

    const updated = await testPrisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updated.totalAmount).toBe(1_200_000);
    expect(updated.description).toBe('Total diperbarui');
    expect(updated.dueDate.toISOString()).toBe('2026-11-20T00:00:00.000Z');
  });

  it('menolak edit dan pembatalan invoice yang memiliki pembayaran', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Lock Invoice' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '1000000',
    });
    await createPayment(owner.agent, invoice.id, { amount: '200000' });

    await owner.agent.get(`/invoices/${invoice.id}/edit`).expect(303);

    const detail = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    const csrfToken = extractCsrfToken(detail.text);

    await owner.agent
      .post(`/invoices/${invoice.id}`)
      .type('form')
      .send({
        _csrf: csrfToken,
        issueDate: '2026-11-08',
        dueDate: '2026-11-20',
        totalAmount: '900000',
      })
      .expect(303);

    const unchanged = await testPrisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(unchanged.totalAmount).toBe(1_000_000);

    await owner.agent
      .post(`/invoices/${invoice.id}/cancel`)
      .type('form')
      .send({ _csrf: csrfToken, reason: 'Ingin dibatalkan' })
      .expect(303);

    const notCancelled = await testPrisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(notCancelled.cancelledAt).toBeNull();

    const afterCancel = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    expect(afterCancel.text).toContain('Batalkan seluruh pembayaran terlebih dahulu');
  });

  it('membatalkan invoice tanpa pembayaran dan menyimpan alasannya', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Cancel Invoice' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, { rentalRecordId: rental.id });

    const detail = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    const csrfToken = extractCsrfToken(detail.text);

    await owner.agent
      .post(`/invoices/${invoice.id}/cancel`)
      .type('form')
      .send({ _csrf: csrfToken, reason: '  Salah membuat tagihan  ' })
      .expect(303);

    const cancelled = await testPrisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    expect(cancelled.cancellationReason).toBe('Salah membuat tagihan');

    const page = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    expect(page.text).toContain('Dibatalkan');
    expect(page.text).toContain('Salah membuat tagihan');

    const filtered = await owner.agent.get('/invoices?status=CANCELLED').expect(200);
    expect(filtered.text).toContain(invoice.id);
  });

  it('memungkinkan pembatalan setelah seluruh pembayaran di-void', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Cancel Void' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '1000000',
    });
    await createPayment(owner.agent, invoice.id, { amount: '300000' });

    const payment = await testPrisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    const paymentPage = await owner.agent.get(`/payments/${payment.id}`).expect(200);
    const voidCsrf = extractCsrfToken(paymentPage.text);
    await owner.agent
      .post(`/payments/${payment.id}/void`)
      .type('form')
      .send({ _csrf: voidCsrf, reason: 'Salah input' })
      .expect(303);

    const detail = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    const csrfToken = extractCsrfToken(detail.text);
    await owner.agent
      .post(`/invoices/${invoice.id}/cancel`)
      .type('form')
      .send({ _csrf: csrfToken, reason: 'Dibatalkan setelah void' })
      .expect(303);

    const cancelled = await testPrisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(cancelled.cancelledAt).toBeInstanceOf(Date);
    expect(cancelled.cancellationReason).toBe('Dibatalkan setelah void');
  });

  it('menghitung status UNPAID, PARTIAL, PAID, dan OVERDUE', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Status Invoice' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });

    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '1500000',
      dueDate: '2099-12-31',
    });

    let detail = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    expect(detail.text).toContain('Belum dibayar');

    await createPayment(owner.agent, invoice.id, { amount: '500000' });
    detail = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    expect(detail.text).toContain('Dibayar sebagian');

    await createPayment(owner.agent, invoice.id, { amount: '1000000' });
    detail = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    expect(detail.text).toContain('Lunas');
    expect(detail.text).toContain('Rp0');

    const overdueInvoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '400000',
      issueDate: '2020-01-01',
      dueDate: '2020-01-10',
    });

    detail = await owner.agent.get(`/invoices/${overdueInvoice.id}`).expect(200);
    expect(detail.text).toContain('Terlambat');

    const filtered = await owner.agent.get('/invoices?status=OVERDUE').expect(200);
    expect(filtered.text).toContain(overdueInvoice.id);
  });

  it('mencari invoice dan memfilter berdasarkan status', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Filter Invoice' });
    const customerA = await createCustomer(owner.agent, {
      name: 'Alpha Invoice',
      whatsappNumber: '081255550010',
    });
    const customerB = await createCustomer(owner.agent, {
      name: 'Beta Invoice',
      whatsappNumber: '081255550011',
    });
    const rentalA = await createRental(owner.agent, { customerId: customerA.id });
    const rentalB = await createRental(owner.agent, { customerId: customerB.id });

    const invoiceA = await createInvoice(owner.agent, {
      rentalRecordId: rentalA.id,
      totalAmount: '500000',
    });
    const invoiceB = await createInvoice(owner.agent, {
      rentalRecordId: rentalB.id,
      totalAmount: '600000',
    });
    await createPayment(owner.agent, invoiceB.id, { amount: '600000' });

    const byCustomer = await owner.agent.get('/invoices?q=Alpha+Invoice').expect(200);
    expect(byCustomer.text).toContain(invoiceA.id);
    expect(byCustomer.text).not.toContain(invoiceB.id);

    const byNumber = await owner.agent.get('/invoices?q=INV-00002').expect(200);
    expect(byNumber.text).toContain(invoiceB.id);
    expect(byNumber.text).not.toContain(invoiceA.id);

    const paid = await owner.agent.get('/invoices?status=PAID').expect(200);
    expect(paid.text).toContain(invoiceB.id);
    expect(paid.text).not.toContain(invoiceA.id);
  });

  it('menampilkan pagination invoice', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Pagination Invoice' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const now = Date.now();

    await testPrisma.invoice.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        businessId: owner.businessId,
        rentalRecordId: rental.id,
        invoiceNumber: `INV-SEED-${String(index + 1).padStart(2, '0')}`,
        issueDate: new Date('2026-11-08T00:00:00.000Z'),
        dueDate: new Date('2099-12-31T00:00:00.000Z'),
        totalAmount: 100_000,
        createdAt: new Date(now - index * 1_000),
      })),
    });

    const secondPage = await owner.agent.get('/invoices?page=2').expect(200);
    expect(secondPage.text).toContain('Menampilkan');
    expect(secondPage.text).toContain('INV-SEED-11');
    expect(secondPage.text).toContain('INV-SEED-12');
    expect(secondPage.text).not.toContain('INV-SEED-01');
  });

  it('tidak mengakses atau mengubah invoice bisnis lain', async () => {
    const ownerA = await registerTestUser(server, { businessName: 'Rental Invoice A' });
    const ownerB = await registerTestUser(server, { businessName: 'Rental Invoice B' });
    const customerA = await createCustomer(ownerA.agent);
    const rentalA = await createRental(ownerA.agent, { customerId: customerA.id });
    const invoiceA = await createInvoice(ownerA.agent, { rentalRecordId: rentalA.id });

    await ownerB.agent.get(`/invoices/${invoiceA.id}`).expect(404);
    await ownerB.agent.get(`/invoices/${invoiceA.id}/edit`).expect(404);

    const page = await ownerB.agent.get('/invoices/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);
    await ownerB.agent
      .post(`/invoices/${invoiceA.id}`)
      .type('form')
      .send({
        _csrf: csrfToken,
        issueDate: '2026-11-08',
        dueDate: '2026-11-15',
        totalAmount: '1000',
      })
      .expect(404);

    await ownerB.agent
      .post(`/invoices/${invoiceA.id}/cancel`)
      .type('form')
      .send({ _csrf: csrfToken, reason: 'Coba batalkan' })
      .expect(404);

    const list = await ownerB.agent.get('/invoices').expect(200);
    expect(list.text).not.toContain(invoiceA.id);
  });

  it('menolak manipulasi businessId dan request tanpa CSRF', async () => {
    const owner = await registerTestUser(server);
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const page = await owner.agent.get('/invoices/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);

    await owner.agent
      .post('/invoices')
      .type('form')
      .send({
        _csrf: csrfToken,
        businessId: 'business-lain',
        rentalRecordId: rental.id,
        issueDate: '2026-11-08',
        dueDate: '2026-11-15',
        totalAmount: '1000',
      })
      .expect(403);

    await owner.agent.get('/invoices?businessId=lain').expect(403);

    await owner.agent
      .post('/invoices')
      .type('form')
      .send({
        rentalRecordId: rental.id,
        issueDate: '2026-11-08',
        dueDate: '2026-11-15',
        totalAmount: '1000',
      })
      .expect(403);
  });
});
