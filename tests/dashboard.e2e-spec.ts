import type { NestExpressApplication } from '@nestjs/platform-express';

import { registerTestUser, testPrisma } from './utils/auth.js';
import { extractCsrfToken } from './utils/cookies.js';
import { createCustomer, createInvoice, createPayment, createRental } from './utils/domain.js';
import { createTestApplication } from './utils/create-app.js';

describe('Dashboard (e2e)', () => {
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

  it('menampilkan empty state untuk bisnis baru', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Kosong' });

    const dashboard = await owner.agent.get('/dashboard').expect(200);

    expect(dashboard.text).toContain('Ringkasan bisnis');
    expect(dashboard.text).toContain('Belum ada tagihan');
    expect(dashboard.text).toContain('Belum ada pembayaran');
    expect(dashboard.text).toContain('Rental Kosong');
  });

  it('menampilkan metrik keuangan dan data terbaru milik bisnis sendiri', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Statistik' });
    const other = await registerTestUser(server, { businessName: 'Rental Lain' });

    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan Statistik',
      whatsappNumber: '081234440001',
    });
    const rental = await createRental(owner.agent, {
      customerId: customer.id,
      itemName: 'Kamera Statistik',
    });

    const partialInvoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '1.000.000',
      dueDate: '2099-12-31',
    });
    await createPayment(owner.agent, partialInvoice.id, { amount: '400.000' });

    const paidInvoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '500.000',
      dueDate: '2099-12-31',
    });
    await createPayment(owner.agent, paidInvoice.id, { amount: '500.000' });

    const cancelledInvoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '300.000',
      dueDate: '2099-12-31',
    });
    const cancelledDetail = await owner.agent.get(`/invoices/${cancelledInvoice.id}`).expect(200);
    const cancelCsrf = extractCsrfToken(cancelledDetail.text);
    await owner.agent
      .post(`/invoices/${cancelledInvoice.id}/cancel`)
      .type('form')
      .send({ _csrf: cancelCsrf, reason: 'Dibatalkan untuk uji' })
      .expect(303);

    const overdueInvoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '200.000',
      issueDate: '2020-01-01',
      dueDate: '2020-01-10',
    });

    const otherCustomer = await createCustomer(other.agent, {
      name: 'Pelanggan Tenant Lain',
      whatsappNumber: '081234440003',
    });
    const otherRental = await createRental(other.agent, {
      customerId: otherCustomer.id,
      itemName: 'Barang Tenant Lain',
    });
    await createInvoice(other.agent, {
      rentalRecordId: otherRental.id,
      totalAmount: '700.000',
      dueDate: '2099-12-31',
    });

    const dashboard = await owner.agent.get('/dashboard').expect(200);

    expect(dashboard.text).toMatch(/Tagihan Belum Lunas<\/p>\s*<p[^>]*>\s*Rp800\.000\s*<\/p>/);
    expect(dashboard.text).toMatch(/Pembayaran Diterima<\/p>\s*<p[^>]*>\s*Rp900\.000\s*<\/p>/);
    expect(dashboard.text).toMatch(/Tagihan Belum Dibayar<\/p>\s*<p[^>]*>\s*0\s*<\/p>/);
    expect(dashboard.text).toMatch(/Tagihan Dibayar Sebagian<\/p>\s*<p[^>]*>\s*1\s*<\/p>/);
    expect(dashboard.text).toMatch(/Tagihan Terlambat<\/p>\s*<p[^>]*>\s*1\s*<\/p>/);
    expect(dashboard.text).toMatch(/Tagihan Lunas<\/p>\s*<p[^>]*>\s*1\s*<\/p>/);
    expect(dashboard.text).toMatch(/Pelanggan<\/p>\s*<p[^>]*>\s*1\s*<\/p>/);
    expect(dashboard.text).toMatch(/Penyewaan Aktif<\/p>\s*<p[^>]*>\s*1\s*<\/p>/);

    expect(dashboard.text).toContain(partialInvoice.id);
    expect(dashboard.text).toContain(paidInvoice.id);
    expect(dashboard.text).toContain(cancelledInvoice.id);
    expect(dashboard.text).toContain(overdueInvoice.id);
    expect(dashboard.text).toContain('Pelanggan Statistik');

    expect(dashboard.text).not.toContain('Pelanggan Tenant Lain');
    expect(dashboard.text).not.toContain('Barang Tenant Lain');
  });

  it('tidak menghitung pembayaran void dalam total diterima', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Void Dashboard' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '500.000',
      dueDate: '2099-12-31',
    });
    await createPayment(owner.agent, invoice.id, { amount: '200.000' });

    const payment = await testPrisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    const page = await owner.agent.get(`/payments/${payment.id}`).expect(200);
    const csrfToken = extractCsrfToken(page.text);
    await owner.agent
      .post(`/payments/${payment.id}/void`)
      .type('form')
      .send({ _csrf: csrfToken, reason: 'Salah input' })
      .expect(303);

    const dashboard = await owner.agent.get('/dashboard').expect(200);

    expect(dashboard.text).toMatch(/Pembayaran Diterima<\/p>\s*<p[^>]*>\s*Rp0\s*<\/p>/);
    expect(dashboard.text).toMatch(/Tagihan Belum Lunas<\/p>\s*<p[^>]*>\s*Rp500\.000\s*<\/p>/);
    expect(dashboard.text).toMatch(/Tagihan Belum Dibayar<\/p>\s*<p[^>]*>\s*1\s*<\/p>/);
    expect(dashboard.text).toContain(payment.id);
    expect(dashboard.text).toContain('Dibatalkan');
  });
});
