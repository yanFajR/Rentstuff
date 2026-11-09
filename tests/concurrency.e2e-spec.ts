import type { NestExpressApplication } from '@nestjs/platform-express';

import { addDaysToDateOnly, todayDateOnly } from '../src/common/helpers/date-only.js';
import { registerTestUser, testPrisma } from './utils/auth.js';
import { extractCsrfToken } from './utils/cookies.js';
import { createCustomer, createInvoice, createRental } from './utils/domain.js';
import { createTestApplication } from './utils/create-app.js';

const today = todayDateOnly('Asia/Jakarta');

async function base(server: unknown, name: string) {
  const owner = await registerTestUser(server, { businessName: name });
  const customer = await createCustomer(owner.agent, { whatsappNumber: '081255580001' });
  const rental = await createRental(owner.agent, {
    customerId: customer.id,
    startDate: today,
    endDate: addDaysToDateOnly(today, 2),
  });
  return { owner, customer, rental };
}

describe('Concurrency & SQLite locking (e2e)', () => {
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

  it('mencegah overpayment pada dua pembayaran bersamaan', async () => {
    const { owner, rental } = await base(server, 'Rental Concurrency Payment');
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: today,
      dueDate: addDaysToDateOnly(today, 20),
      totalAmount: '1.000.000',
    });
    const page = await owner.agent.get(`/invoices/${invoice.id}/payments/new`).expect(200);
    const csrf = extractCsrfToken(page.text);

    const responses = await Promise.all([
      owner.agent.post(`/invoices/${invoice.id}/payments`).type('form').send({
        _csrf: csrf,
        amount: '700.000',
        paymentDate: today,
        method: 'BANK_TRANSFER',
        reference: 'CONCURRENT-A',
      }),
      owner.agent.post(`/invoices/${invoice.id}/payments`).type('form').send({
        _csrf: csrf,
        amount: '700.000',
        paymentDate: today,
        method: 'CASH',
        reference: 'CONCURRENT-B',
      }),
    ]);

    expect(responses.map((response) => response.status).sort()).toEqual([303, 422]);

    const payments = await testPrisma.payment.findMany({
      where: { invoiceId: invoice.id, voidedAt: null },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount).toBe(700_000);
    expect(payments.reduce((total, payment) => total + payment.amount, 0)).toBeLessThanOrEqual(
      1_000_000,
    );
  });

  it('membuat dua invoice bersamaan tanpa nomor duplikat', async () => {
    const { owner, rental } = await base(server, 'Rental Concurrency Invoice');
    const page = await owner.agent.get('/invoices/new').expect(200);
    const csrf = extractCsrfToken(page.text);
    const payload = {
      _csrf: csrf,
      rentalRecordId: rental.id,
      issueDate: today,
      dueDate: addDaysToDateOnly(today, 10),
      totalAmount: '250.000',
    };

    const responses = await Promise.all([
      owner.agent.post('/invoices').type('form').send(payload),
      owner.agent.post('/invoices').type('form').send(payload),
    ]);
    expect(responses.map((response) => response.status)).toEqual([303, 303]);

    const invoices = await testPrisma.invoice.findMany({
      where: { businessId: owner.businessId },
      orderBy: { invoiceNumber: 'asc' },
    });
    expect(invoices).toHaveLength(2);
    expect(new Set(invoices.map((invoice) => invoice.invoiceNumber)).size).toBe(2);
  });

  it('menjalankan scheduler bersamaan tanpa job duplikat', async () => {
    const { owner, rental } = await base(server, 'Rental Concurrency Scheduler');
    await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: today,
      dueDate: addDaysToDateOnly(today, 3),
      totalAmount: '300.000',
    });
    const page = await owner.agent.get('/reminders').expect(200);
    const csrf = extractCsrfToken(page.text);
    const payload = { _csrf: csrf };

    const responses = await Promise.all([
      owner.agent.post('/reminders/run').type('form').send(payload),
      owner.agent.post('/reminders/run').type('form').send(payload),
    ]);
    expect(responses.map((response) => response.status)).toEqual([303, 303]);

    const jobs = await testPrisma.reminderJob.findMany({
      where: { businessId: owner.businessId },
    });
    expect(jobs).toHaveLength(4);
    expect(
      new Set(
        jobs.map(
          (job) => `${job.invoiceId}:${job.reminderType}:${job.scheduledDate.toISOString()}`,
        ),
      ).size,
    ).toBe(4);
  });

  it('menjaga konsistensi saat pembayaran bersamaan dengan rekonsiliasi reminder', async () => {
    const { owner, rental } = await base(server, 'Rental Concurrency Reconcile');
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: today,
      dueDate: addDaysToDateOnly(today, 3),
      totalAmount: '400.000',
    });
    const reminderPage = await owner.agent.get('/reminders').expect(200);
    const csrf = extractCsrfToken(reminderPage.text);
    await owner.agent.post('/reminders/run').type('form').send({ _csrf: csrf }).expect(303);

    const paymentPage = await owner.agent.get(`/invoices/${invoice.id}/payments/new`).expect(200);
    const paymentCsrf = extractCsrfToken(paymentPage.text);
    const responses = await Promise.all([
      owner.agent.post(`/invoices/${invoice.id}/payments`).type('form').send({
        _csrf: paymentCsrf,
        amount: '400.000',
        paymentDate: today,
        method: 'CASH',
        reference: 'CONCURRENT-RECON',
      }),
      owner.agent.post('/reminders/run').type('form').send({ _csrf: csrf }),
    ]);

    expect(responses[0].status).toBe(303);
    expect([303, 422]).toContain(responses[1].status);

    const payments = await testPrisma.payment.findMany({
      where: { invoiceId: invoice.id, voidedAt: null },
    });
    expect(payments).toHaveLength(1);
    const jobs = await testPrisma.reminderJob.findMany({ where: { invoiceId: invoice.id } });
    expect(jobs).toHaveLength(4);
    expect(jobs.every((job) => job.status === 'SKIPPED')).toBe(true);
  });

  it('menyelesaikan dua update profil bersamaan tanpa data rusak', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Concurrency Profile' });
    const dashboard = await owner.agent.get('/dashboard').expect(200);
    const csrf = extractCsrfToken(dashboard.text);
    const makePayload = (name: string) => ({
      _csrf: csrf,
      businessName: name,
      ownerName: name,
      whatsappNumber: '',
      address: '',
      description: '',
    });

    const responses = await Promise.all([
      owner.agent.post('/settings/business').type('form').send(makePayload('Rental Concurrent A')),
      owner.agent.post('/settings/business').type('form').send(makePayload('Rental Concurrent B')),
    ]);
    expect(responses.map((response) => response.status)).toEqual([303, 303]);

    const business = await testPrisma.business.findUniqueOrThrow({
      where: { id: owner.businessId },
    });
    const user = await testPrisma.user.findUniqueOrThrow({ where: { id: owner.userId } });
    expect(['Rental Concurrent A', 'Rental Concurrent B']).toContain(business.name);
    expect(['Rental Concurrent A', 'Rental Concurrent B']).toContain(user.name);
    expect(user.name).toBe(business.name);
  });
});
