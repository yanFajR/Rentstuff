import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { registerTestUser, testPrisma } from './utils/auth.js';
import { extractCsrfToken } from './utils/cookies.js';
import { createCustomer, createInvoice, createPayment, createRental } from './utils/domain.js';
import { createTestApplication } from './utils/create-app.js';

describe('Payment management (e2e)', () => {
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

  it('menolak akses detail pembayaran tanpa login', async () => {
    await request(server).get('/payments/sesi-palsu').expect(302).expect('Location', '/login');
  });

  it('menerima pembayaran parsial lalu pembayaran pelunasan', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Payment' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan Payment',
      whatsappNumber: '081266660001',
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

    await createPayment(owner.agent, invoice.id, {
      amount: '400.000',
      method: 'BANK_TRANSFER',
      reference: 'TRX-001',
      notes: 'Pembayaran pertama',
    });

    const firstPayment = await testPrisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    expect(firstPayment.amount).toBe(400_000);
    expect(firstPayment.businessId).toBe(owner.businessId);
    expect(firstPayment.recordedByUserId).toBe(owner.userId);
    expect(firstPayment.voidedAt).toBeNull();

    let detail = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    expect(detail.text).toContain('Dibayar sebagian');
    expect(detail.text).toContain('Rp400.000');
    expect(detail.text).toContain('Rp600.000');

    await createPayment(owner.agent, invoice.id, { amount: '600.000' });

    detail = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    expect(detail.text).toContain('Lunas');
    expect(detail.text).toContain('Rp0');

    const paymentDetail = await owner.agent.get(`/payments/${firstPayment.id}`).expect(200);
    expect(paymentDetail.text).toContain('Pelanggan Payment');
    expect(paymentDetail.text).toContain('Transfer Bank');
    expect(paymentDetail.text).toContain(owner.name);
    expect(paymentDetail.text).toContain('TRX-001');
  });

  it('menolak pembayaran melebihi sisa tagihan', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Overpay' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '1.000.000',
      dueDate: '2099-12-31',
    });
    await createPayment(owner.agent, invoice.id, { amount: '400.000' });

    const form = await owner.agent.get(`/invoices/${invoice.id}/payments/new`).expect(200);
    const csrfToken = extractCsrfToken(form.text);

    const response = await owner.agent
      .post(`/invoices/${invoice.id}/payments`)
      .type('form')
      .send({
        _csrf: csrfToken,
        amount: '700.000',
        paymentDate: '2026-11-10',
        method: 'CASH',
      })
      .expect(422);

    expect(response.text).toContain('melebihi sisa tagihan');
    const count = await testPrisma.payment.count({ where: { invoiceId: invoice.id } });
    expect(count).toBe(1);
  });

  it('menolak nominal nol, negatif, dan desimal', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Nominal Payment' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '1.000.000',
      dueDate: '2099-12-31',
    });
    const form = await owner.agent.get(`/invoices/${invoice.id}/payments/new`).expect(200);
    const csrfToken = extractCsrfToken(form.text);

    for (const amount of ['0', '-500', '12.5', '']) {
      const response = await owner.agent
        .post(`/invoices/${invoice.id}/payments`)
        .type('form')
        .send({
          _csrf: csrfToken,
          amount,
          paymentDate: '2026-11-10',
          method: 'CASH',
        })
        .expect(422);
      expect(response.text).toContain('Nominal pembayaran');
    }

    expect(await testPrisma.payment.count({ where: { invoiceId: invoice.id } })).toBe(0);
  });

  it('menolak pembayaran pada invoice lunas atau dibatalkan', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Paid Payment' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const paidInvoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '500.000',
      dueDate: '2099-12-31',
    });
    await createPayment(owner.agent, paidInvoice.id, { amount: '500.000' });

    const paidDetail = await owner.agent.get(`/invoices/${paidInvoice.id}`).expect(200);
    const paidCsrf = extractCsrfToken(paidDetail.text);
    await owner.agent
      .post(`/invoices/${paidInvoice.id}/payments`)
      .type('form')
      .send({
        _csrf: paidCsrf,
        amount: '1000',
        paymentDate: '2026-11-10',
        method: 'CASH',
      })
      .expect(303);

    const paidAfter = await owner.agent.get(`/invoices/${paidInvoice.id}`).expect(200);
    expect(paidAfter.text).toContain('Invoice ini sudah lunas');
    expect(await testPrisma.payment.count({ where: { invoiceId: paidInvoice.id } })).toBe(1);

    const cancelledInvoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '300.000',
      dueDate: '2099-12-31',
    });
    const cancelDetail = await owner.agent.get(`/invoices/${cancelledInvoice.id}`).expect(200);
    const cancelCsrf = extractCsrfToken(cancelDetail.text);
    await owner.agent
      .post(`/invoices/${cancelledInvoice.id}/cancel`)
      .type('form')
      .send({ _csrf: cancelCsrf, reason: 'Tagihan batal' })
      .expect(303);

    await owner.agent
      .post(`/invoices/${cancelledInvoice.id}/payments`)
      .type('form')
      .send({
        _csrf: cancelCsrf,
        amount: '1000',
        paymentDate: '2026-11-10',
        method: 'CASH',
      })
      .expect(303);

    expect(await testPrisma.payment.count({ where: { invoiceId: cancelledInvoice.id } })).toBe(0);
  });

  it('void pembayaran mengembalikan outstanding dan status invoice', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Void' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '1.000.000',
      dueDate: '2099-12-31',
    });
    await createPayment(owner.agent, invoice.id, { amount: '300.000' });

    const payment = await testPrisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    const page = await owner.agent.get(`/payments/${payment.id}`).expect(200);
    const csrfToken = extractCsrfToken(page.text);

    await owner.agent
      .post(`/payments/${payment.id}/void`)
      .type('form')
      .send({ _csrf: csrfToken, reason: '  Nominal salah  ' })
      .expect(303);

    const voided = await testPrisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(voided.voidedAt).toBeInstanceOf(Date);
    expect(voided.voidReason).toBe('Nominal salah');
    expect(voided.voidedByUserId).toBe(owner.userId);

    const invoicePage = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    expect(invoicePage.text).toContain('Belum dibayar');
    expect(invoicePage.text).toContain('Rp0');
    expect(invoicePage.text).toContain('Rp1.000.000');

    const voidPage = await owner.agent.get(`/payments/${payment.id}`).expect(200);
    expect(voidPage.text).toContain('Dibatalkan');
    expect(voidPage.text).toContain('Nominal salah');

    const list = await owner.agent.get('/payments?status=void').expect(200);
    expect(list.text).toContain(payment.id);
  });

  it('menghitung ulang outstanding saat salah satu pembayaran di-void', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Multi Void' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '1.000.000',
      dueDate: '2099-12-31',
    });
    await createPayment(owner.agent, invoice.id, { amount: '200.000' });
    await createPayment(owner.agent, invoice.id, { amount: '300.000' });

    const first = await testPrisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id, amount: 200_000 },
    });
    const page = await owner.agent.get(`/payments/${first.id}`).expect(200);
    const csrfToken = extractCsrfToken(page.text);
    await owner.agent
      .post(`/payments/${first.id}/void`)
      .type('form')
      .send({ _csrf: csrfToken, reason: 'Salah satu pembayaran' })
      .expect(303);

    const detail = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    expect(detail.text).toContain('Dibayar sebagian');
    expect(detail.text).toContain('Rp300.000');
    expect(detail.text).toContain('Rp700.000');

    const validTotal = await testPrisma.payment.aggregate({
      where: { invoiceId: invoice.id, voidedAt: null },
      _sum: { amount: true },
    });
    expect(validTotal._sum.amount).toBe(300_000);
  });

  it('mewajibkan alasan void dan menolak void dua kali', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Void Rules' });
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
      .send({ _csrf: csrfToken, reason: '' })
      .expect(303);

    let stored = await testPrisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    expect(stored.voidedAt).toBeNull();

    await owner.agent
      .post(`/payments/${payment.id}/void`)
      .type('form')
      .send({ _csrf: csrfToken, reason: 'Salah input' })
      .expect(303);

    stored = await testPrisma.payment.findUniqueOrThrow({ where: { id: payment.id } });
    const firstVoidedAt = stored.voidedAt;
    expect(firstVoidedAt).toBeInstanceOf(Date);

    await owner.agent
      .post(`/payments/${payment.id}/void`)
      .type('form')
      .send({ _csrf: csrfToken, reason: 'Void kedua' })
      .expect(303);

    const afterSecondVoid = await testPrisma.payment.findUniqueOrThrow({
      where: { id: payment.id },
    });
    expect(afterSecondVoid.voidReason).toBe('Salah input');
    expect(afterSecondVoid.voidedAt?.getTime()).toBe(firstVoidedAt?.getTime());
  });

  it('mengabaikan recordedByUserId dari body dan memakai user session', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Recorded By' });
    const other = await registerTestUser(server, { businessName: 'Rental Lain' });
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '500.000',
      dueDate: '2099-12-31',
    });
    const form = await owner.agent.get(`/invoices/${invoice.id}/payments/new`).expect(200);
    const csrfToken = extractCsrfToken(form.text);

    await owner.agent
      .post(`/invoices/${invoice.id}/payments`)
      .type('form')
      .send({
        _csrf: csrfToken,
        amount: '100.000',
        paymentDate: '2026-11-10',
        method: 'CASH',
        recordedByUserId: other.userId,
      })
      .expect(303);

    const payment = await testPrisma.payment.findFirstOrThrow({
      where: { invoiceId: invoice.id },
    });
    expect(payment.recordedByUserId).toBe(owner.userId);
    expect(payment.recordedByUserId).not.toBe(other.userId);
  });

  it('tidak mengakses atau mengubah pembayaran bisnis lain', async () => {
    const ownerA = await registerTestUser(server, { businessName: 'Rental Payment A' });
    const ownerB = await registerTestUser(server, { businessName: 'Rental Payment B' });
    const customerA = await createCustomer(ownerA.agent);
    const rentalA = await createRental(ownerA.agent, { customerId: customerA.id });
    const invoiceA = await createInvoice(ownerA.agent, {
      rentalRecordId: rentalA.id,
      totalAmount: '500.000',
      dueDate: '2099-12-31',
    });
    await createPayment(ownerA.agent, invoiceA.id, { amount: '100.000' });
    const paymentA = await testPrisma.payment.findFirstOrThrow({
      where: { invoiceId: invoiceA.id },
    });

    await ownerB.agent.get(`/payments/${paymentA.id}`).expect(404);

    const page = await ownerB.agent.get('/invoices/new').expect(200);
    const csrfToken = extractCsrfToken(page.text);
    await ownerB.agent
      .post(`/payments/${paymentA.id}/void`)
      .type('form')
      .send({ _csrf: csrfToken, reason: 'Coba void' })
      .expect(404);

    await ownerB.agent
      .post(`/invoices/${invoiceA.id}/payments`)
      .type('form')
      .send({
        _csrf: csrfToken,
        amount: '1000',
        paymentDate: '2026-11-10',
        method: 'CASH',
      })
      .expect(404);

    const list = await ownerB.agent.get('/payments').expect(200);
    expect(list.text).not.toContain(paymentA.id);

    const unchanged = await testPrisma.payment.findUniqueOrThrow({
      where: { id: paymentA.id },
    });
    expect(unchanged.voidedAt).toBeNull();
  });

  it('menolak manipulasi businessId dan request tanpa CSRF', async () => {
    const owner = await registerTestUser(server);
    const customer = await createCustomer(owner.agent);
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      totalAmount: '500.000',
      dueDate: '2099-12-31',
    });
    const form = await owner.agent.get(`/invoices/${invoice.id}/payments/new`).expect(200);
    const csrfToken = extractCsrfToken(form.text);

    await owner.agent
      .post(`/invoices/${invoice.id}/payments`)
      .type('form')
      .send({
        _csrf: csrfToken,
        businessId: 'business-lain',
        amount: '1000',
        paymentDate: '2026-11-10',
        method: 'CASH',
      })
      .expect(403);

    await owner.agent
      .post(`/invoices/${invoice.id}/payments`)
      .type('form')
      .send({ amount: '1000', paymentDate: '2026-11-10', method: 'CASH' })
      .expect(403);
  });
});
