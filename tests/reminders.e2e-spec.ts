import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { addDaysToDateOnly, todayDateOnly } from '../src/common/helpers/date-only.js';
import { formatDate } from '../src/common/helpers/format.js';
import { registerTestUser, testPrisma } from './utils/auth.js';
import { extractCsrfToken } from './utils/cookies.js';
import { createCustomer, createInvoice, createPayment, createRental } from './utils/domain.js';
import { createTestApplication } from './utils/create-app.js';

const timezone = 'Asia/Jakarta';

async function runScheduler(agent: ReturnType<typeof request.agent>): Promise<void> {
  const page = await agent.get('/reminders').expect(200);
  const csrfToken = extractCsrfToken(page.text);
  await agent.post('/reminders/run').type('form').send({ _csrf: csrfToken }).expect(303);
}

function dateFromToday(offset: number): string {
  return addDaysToDateOnly(todayDateOnly(timezone), offset);
}

describe('Reminder management (e2e)', () => {
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
    await request(server).get('/reminders').expect(302).expect('Location', '/login');
    await request(server)
      .get('/reminders/reminder-apa-saja')
      .expect(302)
      .expect('Location', '/login');
  });

  it('membuat job sesuai aturan H-3, H-1, jatuh tempo, dan H+1 tanpa duplikasi', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Scheduler' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan Scheduler',
      whatsappNumber: '081255560001',
    });
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const issueDate = dateFromToday(-10);

    const dueInThree = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate,
      dueDate: dateFromToday(3),
      totalAmount: '1.000.000',
    });
    const dueInOne = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate,
      dueDate: dateFromToday(1),
      totalAmount: '900.000',
    });
    const dueToday = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate,
      dueDate: dateFromToday(0),
      totalAmount: '800.000',
    });
    const dueYesterday = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate,
      dueDate: dateFromToday(-1),
      totalAmount: '700.000',
    });
    const dueInTwo = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate,
      dueDate: dateFromToday(2),
      totalAmount: '600.000',
    });
    const dueInFour = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate,
      dueDate: dateFromToday(4),
      totalAmount: '500.000',
    });

    await runScheduler(owner.agent);

    const jobs = await testPrisma.reminderJob.findMany({
      where: { businessId: owner.businessId },
      orderBy: [{ invoiceId: 'asc' }, { scheduledDate: 'asc' }],
    });

    const forInvoice = (invoiceId: string) =>
      jobs
        .filter((job) => job.invoiceId === invoiceId)
        .map((job) => [job.reminderType, job.status]);

    expect(forInvoice(dueInThree.id)).toEqual([
      ['H_MINUS_3', 'READY'],
      ['H_MINUS_1', 'PENDING'],
      ['DUE_DATE', 'PENDING'],
      ['H_PLUS_1', 'PENDING'],
    ]);
    expect(forInvoice(dueInOne.id)).toEqual([
      ['H_MINUS_1', 'READY'],
      ['DUE_DATE', 'PENDING'],
      ['H_PLUS_1', 'PENDING'],
    ]);
    expect(forInvoice(dueToday.id)).toEqual([
      ['DUE_DATE', 'READY'],
      ['H_PLUS_1', 'PENDING'],
    ]);
    expect(forInvoice(dueYesterday.id)).toEqual([['H_PLUS_1', 'READY']]);
    expect(forInvoice(dueInTwo.id)).toEqual([
      ['H_MINUS_1', 'PENDING'],
      ['DUE_DATE', 'PENDING'],
      ['H_PLUS_1', 'PENDING'],
    ]);
    expect(forInvoice(dueInFour.id)).toEqual([]);
    expect(jobs).toHaveLength(13);

    const createdCount = await testPrisma.reminderActivity.count({
      where: { businessId: owner.businessId, activityType: 'CREATED' },
    });
    expect(createdCount).toBe(13);

    await runScheduler(owner.agent);

    expect(await testPrisma.reminderJob.count({ where: { businessId: owner.businessId } })).toBe(
      13,
    );
    expect(
      await testPrisma.reminderActivity.count({
        where: { businessId: owner.businessId, activityType: 'CREATED' },
      }),
    ).toBe(13);

    const page = await owner.agent.get('/reminders').expect(200);
    expect(page.text).toContain('Pengingat pembayaran');
    expect(page.text).toContain('Akan jatuh tempo');
    expect(page.text).toContain('Jatuh tempo hari ini');
    expect(page.text).toContain('Terlambat');
  });

  it('mencari, memfilter, dan memaginasi daftar pengingat', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Filter Reminder' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pagination Reminder',
      whatsappNumber: '081255560010',
    });
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const issueDate = dateFromToday(-10);
    const dueDate = dateFromToday(3);

    await testPrisma.invoice.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        businessId: owner.businessId,
        rentalRecordId: rental.id,
        invoiceNumber: `INV-RMD-${String(index + 1).padStart(2, '0')}`,
        issueDate: new Date(`${issueDate}T00:00:00.000Z`),
        dueDate: new Date(`${dueDate}T00:00:00.000Z`),
        totalAmount: 100_000,
      })),
    });

    await runScheduler(owner.agent);

    const filtered = await owner.agent
      .get(`/reminders?type=H_MINUS_3&status=READY&q=Pagination+Reminder`)
      .expect(200);
    expect(filtered.text).toContain('12 pengingat ditemukan');
    expect(filtered.text).toContain('Menampilkan');
    expect(new Set(filtered.text.match(/INV-RMD-\d{2}/g) ?? []).size).toBe(10);

    const byDate = await owner.agent
      .get(`/reminders?type=H_MINUS_3&status=READY&from=${dateFromToday(0)}&to=${dateFromToday(0)}`)
      .expect(200);
    expect(byDate.text).toContain('12 pengingat ditemukan');

    const pageTwo = await owner.agent
      .get('/reminders?type=H_MINUS_3&status=READY&page=2')
      .expect(200);
    expect(pageTwo.text).toContain('12 pengingat ditemukan');
    expect(new Set(pageTwo.text.match(/INV-RMD-\d{2}/g) ?? []).size).toBe(2);
  });

  it('tidak membuat pengingat untuk invoice lunas atau dibatalkan sebelum scheduler', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Status Awal' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan Status Awal',
      whatsappNumber: '081255560020',
    });
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const issueDate = dateFromToday(-10);
    const dueDate = dateFromToday(3);

    const paidInvoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate,
      dueDate,
      totalAmount: '500.000',
    });
    await createPayment(owner.agent, paidInvoice.id, { amount: '500.000' });

    const cancelledInvoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate,
      dueDate,
      totalAmount: '500.000',
    });
    const cancelledDetail = await owner.agent.get(`/invoices/${cancelledInvoice.id}`).expect(200);
    await owner.agent
      .post(`/invoices/${cancelledInvoice.id}/cancel`)
      .type('form')
      .send({
        _csrf: extractCsrfToken(cancelledDetail.text),
        reason: 'Dibatalkan sebelum scheduler',
      })
      .expect(303);

    const partialInvoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate,
      dueDate,
      totalAmount: '1.000.000',
    });
    await createPayment(owner.agent, partialInvoice.id, { amount: '300.000' });

    await runScheduler(owner.agent);

    expect(await testPrisma.reminderJob.count({ where: { invoiceId: paidInvoice.id } })).toBe(0);
    expect(await testPrisma.reminderJob.count({ where: { invoiceId: cancelledInvoice.id } })).toBe(
      0,
    );
    expect(await testPrisma.reminderJob.count({ where: { invoiceId: partialInvoice.id } })).toBe(4);

    const partialJob = await testPrisma.reminderJob.findFirstOrThrow({
      where: { invoiceId: partialInvoice.id, reminderType: 'H_MINUS_3' },
    });
    const detail = await owner.agent.get(`/reminders/${partialJob.id}`).expect(200);
    expect(detail.text).toContain('Rp1.000.000');
    expect(detail.text).toContain('Rp300.000');
    expect(detail.text).toContain('Rp700.000');
    expect(detail.text).toContain('memiliki tagihan sebesar');
  });

  it('mencatat WhatsApp dibuka, lalu status terkirim hanya setelah aksi manual', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental WhatsApp' });
    const customer = await createCustomer(owner.agent, {
      name: 'Budi WhatsApp',
      whatsappNumber: '0812-3456-7890',
    });
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: dateFromToday(-10),
      dueDate: dateFromToday(3),
      totalAmount: '1.500.000',
    });
    await createPayment(owner.agent, invoice.id, { amount: '500.000' });
    await runScheduler(owner.agent);

    const reminder = await testPrisma.reminderJob.findFirstOrThrow({
      where: { invoiceId: invoice.id, reminderType: 'H_MINUS_3' },
    });
    const storedInvoice = await testPrisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });

    const detail = await owner.agent.get(`/reminders/${reminder.id}`).expect(200);
    expect(detail.text).toContain('Pratinjau pesan WhatsApp');
    expect(detail.text).toContain('Halo Budi WhatsApp');
    expect(detail.text).toContain('Rp1.000.000');
    expect(detail.text).toContain('Rental WhatsApp');
    expect(detail.text).toContain('Anda tetap harus menekan tombol kirim');

    const dashboard = await owner.agent.get('/dashboard').expect(200);
    expect(dashboard.text).toContain('Pengingat pembayaran');
    expect(dashboard.text).toContain(storedInvoice.invoiceNumber);
    expect(dashboard.text).toContain('Belum dihubungi');

    const openResponse = await owner.agent
      .post(`/reminders/${reminder.id}/whatsapp`)
      .type('form')
      .send({ _csrf: extractCsrfToken(detail.text) })
      .expect(303);

    const location = openResponse.headers.location as string;
    expect(location).toMatch(/^https:\/\/wa\.me\/6281234567890\?text=/);

    const parsed = new URL(location);
    const message = parsed.searchParams.get('text') ?? '';
    expect(message).toContain('Halo Budi WhatsApp');
    expect(message).toContain(storedInvoice.invoiceNumber);
    expect(message).toContain('Rental WhatsApp');
    expect(message).toContain('Rp1.000.000');
    expect(message).toContain(`Tanggal jatuh tempo: ${formatDate(storedInvoice.dueDate)}`);
    expect(message).not.toContain('Rp1.500.000');

    let activities = await testPrisma.reminderActivity.findMany({
      where: { reminderId: reminder.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(
      activities.filter((activity) => activity.activityType === 'WHATSAPP_OPENED'),
    ).toHaveLength(1);
    expect(activities.filter((activity) => activity.activityType === 'MARKED_SENT')).toHaveLength(
      0,
    );
    expect(activities.find((activity) => activity.activityType === 'WHATSAPP_OPENED')?.userId).toBe(
      owner.userId,
    );

    const afterOpen = await owner.agent.get(`/reminders/${reminder.id}`).expect(200);
    expect(afterOpen.text).toContain('WhatsApp dibuka');
    expect(afterOpen.text).not.toContain('Ditandai sudah dikirim');

    const markResponse = await owner.agent
      .post(`/reminders/${reminder.id}/marked-sent`)
      .type('form')
      .send({
        _csrf: extractCsrfToken(afterOpen.text),
        notes: '  Pelanggan akan transfer besok  ',
        userId: 'user-palsu',
      })
      .expect(303);
    expect(markResponse.headers.location).toBe(`/reminders/${reminder.id}`);

    activities = await testPrisma.reminderActivity.findMany({
      where: { reminderId: reminder.id },
      orderBy: { createdAt: 'asc' },
    });
    const sentActivity = activities.find((activity) => activity.activityType === 'MARKED_SENT');
    expect(sentActivity).toMatchObject({
      userId: owner.userId,
      notes: 'Pelanggan akan transfer besok',
    });

    const afterSent = await owner.agent.get(`/reminders/${reminder.id}`).expect(200);
    expect(afterSent.text).toContain('Ditandai terkirim');
    expect(afterSent.text).toContain('Ditandai sudah dikirim');

    await owner.agent
      .post(`/reminders/${reminder.id}/marked-sent`)
      .type('form')
      .send({ _csrf: extractCsrfToken(afterSent.text), notes: 'Kedua' })
      .expect(303);
    expect(
      await testPrisma.reminderActivity.count({
        where: { reminderId: reminder.id, activityType: 'MARKED_SENT' },
      }),
    ).toBe(1);

    await createPayment(owner.agent, invoice.id, { amount: '1.000.000' });

    const skipped = await testPrisma.reminderJob.findUniqueOrThrow({ where: { id: reminder.id } });
    expect(skipped.status).toBe('SKIPPED');
    expect(skipped.skipReason).toBe('Tagihan sudah lunas.');

    const blockedDetail = await owner.agent.get(`/reminders/${reminder.id}`).expect(200);
    const blocked = await owner.agent
      .post(`/reminders/${reminder.id}/whatsapp`)
      .type('form')
      .send({ _csrf: extractCsrfToken(blockedDetail.text) })
      .expect(303);
    expect(blocked.headers.location).toBe(`/reminders/${reminder.id}`);

    const followed = await owner.agent.get(`/reminders/${reminder.id}`).expect(200);
    expect(followed.text).toContain('Pengingat ini dilewati');
    expect(followed.text).toContain('Tagihan sudah lunas.');
  });

  it('menjaga isolasi tenant, CSRF, dan tidak mempercayai userId dari body', async () => {
    const ownerA = await registerTestUser(server, { businessName: 'Rental Reminder A' });
    const ownerB = await registerTestUser(server, { businessName: 'Rental Reminder B' });
    const customer = await createCustomer(ownerA.agent, {
      name: 'Pelanggan Isolasi',
      whatsappNumber: '081255560030',
    });
    const rental = await createRental(ownerA.agent, { customerId: customer.id });
    const invoice = await createInvoice(ownerA.agent, {
      rentalRecordId: rental.id,
      issueDate: dateFromToday(-10),
      dueDate: dateFromToday(3),
      totalAmount: '400.000',
    });
    await runScheduler(ownerA.agent);

    const storedInvoice = await testPrisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    const reminder = await testPrisma.reminderJob.findFirstOrThrow({
      where: { invoiceId: invoice.id, reminderType: 'H_MINUS_3' },
    });

    await ownerB.agent.get(`/reminders/${reminder.id}`).expect(404);
    const listB = await ownerB.agent.get('/reminders').expect(200);
    expect(listB.text).not.toContain(storedInvoice.invoiceNumber);

    const csrfB = extractCsrfToken(listB.text);
    await ownerB.agent
      .post(`/reminders/${reminder.id}/whatsapp`)
      .type('form')
      .send({ _csrf: csrfB })
      .expect(404);
    await ownerB.agent
      .post(`/reminders/${reminder.id}/marked-sent`)
      .type('form')
      .send({ _csrf: csrfB, userId: ownerA.userId })
      .expect(404);

    await ownerA.agent.get('/reminders?businessId=business-lain').expect(403);

    const pageA = await ownerA.agent.get('/reminders').expect(200);
    const csrfA = extractCsrfToken(pageA.text);
    await ownerA.agent
      .post('/reminders/run')
      .type('form')
      .send({ _csrf: csrfA, businessId: 'business-lain' })
      .expect(403);

    await ownerA.agent.post(`/reminders/${reminder.id}/whatsapp`).type('form').send({}).expect(403);

    await ownerA.agent
      .post(`/reminders/${reminder.id}/marked-sent`)
      .type('form')
      .send({ notes: 'Tanpa token' })
      .expect(403);

    const activityCountBefore = await testPrisma.reminderActivity.count({
      where: { reminderId: reminder.id, activityType: 'MARKED_SENT' },
    });
    await ownerA.agent
      .post(`/reminders/${reminder.id}/marked-sent`)
      .type('form')
      .send({ _csrf: csrfA, userId: 'user-palsu' })
      .expect(303);
    const sent = await testPrisma.reminderActivity.findFirstOrThrow({
      where: { reminderId: reminder.id, activityType: 'MARKED_SENT' },
    });
    expect(sent.userId).toBe(ownerA.userId);
    expect(
      await testPrisma.reminderActivity.count({
        where: { reminderId: reminder.id, activityType: 'MARKED_SENT' },
      }),
    ).toBe(activityCountBefore + 1);
  });

  it('menandai reminder lama SKIPPED saat jatuh tempo berubah', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Ubah Jatuh Tempo' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan Ubah Tempo',
      whatsappNumber: '081255560040',
    });
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: dateFromToday(-10),
      dueDate: dateFromToday(3),
      totalAmount: '300.000',
    });
    await runScheduler(owner.agent);

    const before = await testPrisma.reminderJob.findMany({ where: { invoiceId: invoice.id } });
    expect(before).toHaveLength(4);
    expect(before.every((job) => job.status !== 'SKIPPED')).toBe(true);

    const editPage = await owner.agent.get(`/invoices/${invoice.id}/edit`).expect(200);
    await owner.agent
      .post(`/invoices/${invoice.id}`)
      .type('form')
      .send({
        _csrf: extractCsrfToken(editPage.text),
        issueDate: dateFromToday(-10),
        dueDate: dateFromToday(4),
        totalAmount: '300.000',
      })
      .expect(303);

    const after = await testPrisma.reminderJob.findMany({
      where: { invoiceId: invoice.id },
      orderBy: { scheduledDate: 'asc' },
    });
    expect(after).toHaveLength(4);
    expect(after.every((job) => job.status === 'SKIPPED')).toBe(true);
    expect(after.every((job) => job.skipReason === 'Tanggal jatuh tempo berubah.')).toBe(true);

    await runScheduler(owner.agent);
    expect(await testPrisma.reminderJob.count({ where: { invoiceId: invoice.id } })).toBe(4);
  });

  it('menandai reminder menjadi SKIPPED setelah invoice dibatalkan', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Batal Reminder' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan Batal Reminder',
      whatsappNumber: '081255560045',
    });
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: dateFromToday(-10),
      dueDate: dateFromToday(3),
      totalAmount: '350.000',
    });
    await runScheduler(owner.agent);

    const detail = await owner.agent.get(`/invoices/${invoice.id}`).expect(200);
    await owner.agent
      .post(`/invoices/${invoice.id}/cancel`)
      .type('form')
      .send({
        _csrf: extractCsrfToken(detail.text),
        reason: 'Pelanggan membatalkan penyewaan',
      })
      .expect(303);

    const jobs = await testPrisma.reminderJob.findMany({ where: { invoiceId: invoice.id } });
    expect(jobs).toHaveLength(4);
    expect(jobs.every((job) => job.status === 'SKIPPED')).toBe(true);
    expect(jobs.every((job) => job.skipReason === 'Tagihan dibatalkan.')).toBe(true);
  });

  it('mengaktifkan kembali reminder setelah pembayaran penuh di-void', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Void Reminder' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan Void',
      whatsappNumber: '081255560050',
    });
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: dateFromToday(-10),
      dueDate: dateFromToday(3),
      totalAmount: '600.000',
    });
    await runScheduler(owner.agent);

    const reminder = await testPrisma.reminderJob.findFirstOrThrow({
      where: { invoiceId: invoice.id, reminderType: 'H_MINUS_3' },
    });
    await createPayment(owner.agent, invoice.id, { amount: '600.000' });
    expect(
      (await testPrisma.reminderJob.findUniqueOrThrow({ where: { id: reminder.id } })).status,
    ).toBe('SKIPPED');

    const payment = await testPrisma.payment.findFirstOrThrow({ where: { invoiceId: invoice.id } });
    const paymentPage = await owner.agent.get(`/payments/${payment.id}`).expect(200);
    await owner.agent
      .post(`/payments/${payment.id}/void`)
      .type('form')
      .send({ _csrf: extractCsrfToken(paymentPage.text), reason: 'Transfer gagal' })
      .expect(303);

    const reactivated = await testPrisma.reminderJob.findUniqueOrThrow({
      where: { id: reminder.id },
    });
    expect(reactivated.status).toBe('READY');
    expect(reactivated.skippedAt).toBeNull();
    expect(reactivated.skipReason).toBeNull();
    expect(
      await testPrisma.reminderActivity.count({
        where: { reminderId: reminder.id, activityType: 'REACTIVATED' },
      }),
    ).toBe(1);
  });

  it('tetap menyimpan job setelah aplikasi dimulai ulang', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Persisten' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan Persisten',
      whatsappNumber: '081255560060',
    });
    const rental = await createRental(owner.agent, { customerId: customer.id });
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: dateFromToday(-10),
      dueDate: dateFromToday(3),
      totalAmount: '250.000',
    });
    await runScheduler(owner.agent);
    const storedInvoice = await testPrisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    const jobCount = await testPrisma.reminderJob.count({ where: { invoiceId: invoice.id } });
    expect(jobCount).toBe(4);

    await app.close();
    app = await createTestApplication();
    server = app.getHttpServer();

    const response = await request(server)
      .get('/reminders')
      .set('Cookie', owner.sessionCookie)
      .expect(200);
    expect(response.text).toContain(storedInvoice.invoiceNumber);
    expect(await testPrisma.reminderJob.count({ where: { invoiceId: invoice.id } })).toBe(4);
  });
});
