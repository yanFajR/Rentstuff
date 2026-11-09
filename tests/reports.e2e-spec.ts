import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';

import { addDaysToDateOnly, todayDateOnly } from '../src/common/helpers/date-only.js';
import { registerTestUser, testPrisma } from './utils/auth.js';
import { extractCsrfToken } from './utils/cookies.js';
import { createCustomer, createInvoice, createPayment, createRental } from './utils/domain.js';
import { createTestApplication } from './utils/create-app.js';

const timezone = 'Asia/Jakarta';
const today = todayDateOnly(timezone);
const thisMonthStart = `${today.slice(0, 7)}-01`;
const previousMonthEnd = addDaysToDateOnly(thisMonthStart, -1);
const previousMonthStart = `${previousMonthEnd.slice(0, 7)}-01`;

function inDays(days: number): string {
  return addDaysToDateOnly(today, days);
}

async function cancelInvoice(
  agent: ReturnType<typeof request.agent>,
  invoiceId: string,
  reason = 'Dibatalkan untuk pengujian laporan',
): Promise<void> {
  const detail = await agent.get(`/invoices/${invoiceId}`).expect(200);
  await agent
    .post(`/invoices/${invoiceId}/cancel`)
    .type('form')
    .send({ _csrf: extractCsrfToken(detail.text), reason })
    .expect(303);
}

async function voidPayment(
  agent: ReturnType<typeof request.agent>,
  paymentId: string,
): Promise<void> {
  const page = await agent.get(`/payments/${paymentId}`).expect(200);
  await agent
    .post(`/payments/${paymentId}/void`)
    .type('form')
    .send({ _csrf: extractCsrfToken(page.text), reason: 'Salah input untuk pengujian' })
    .expect(303);
}

async function runReminders(agent: ReturnType<typeof request.agent>): Promise<void> {
  const page = await agent.get('/reminders').expect(200);
  await agent
    .post('/reminders/run')
    .type('form')
    .send({ _csrf: extractCsrfToken(page.text) })
    .expect(303);
}

async function createBase(
  server: unknown,
  businessName: string,
  customerName = 'Pelanggan Laporan',
) {
  const owner = await registerTestUser(server, { businessName });
  const customer = await createCustomer(owner.agent, {
    name: customerName,
    whatsappNumber: '081255570001',
  });
  const rental = await createRental(owner.agent, {
    customerId: customer.id,
    itemName: 'Kamera Laporan',
    startDate: thisMonthStart,
    endDate: today,
    price: '1.000.000',
  });
  return { owner, customer, rental };
}

describe('Reports & CSV (e2e)', () => {
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

  it('menolak akses laporan dan export tanpa login', async () => {
    await request(server).get('/reports').expect(302).expect('Location', '/login');
    await request(server).get('/reports/export/invoices').expect(302).expect('Location', '/login');
  });

  it('menampilkan ringkasan keuangan dengan definisi periode yang benar', async () => {
    const { owner, rental } = await createBase(server, 'Rental Ringkasan Laporan');

    const partial = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: inDays(3),
      totalAmount: '1.000.000',
    });
    await createPayment(owner.agent, partial.id, {
      amount: '400.000',
      paymentDate: today,
      method: 'BANK_TRANSFER',
    });

    const paid = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: inDays(5),
      totalAmount: '600.000',
    });
    await createPayment(owner.agent, paid.id, {
      amount: '600.000',
      paymentDate: today,
      method: 'CASH',
    });

    await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: inDays(5),
      totalAmount: '500.000',
    });

    const cancelled = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: inDays(5),
      totalAmount: '300.000',
    });
    await cancelInvoice(owner.agent, cancelled.id);

    const voidedInvoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: inDays(5),
      totalAmount: '300.000',
    });
    await createPayment(owner.agent, voidedInvoice.id, {
      amount: '100.000',
      paymentDate: today,
      method: 'E_WALLET',
    });
    const voidedPayment = await testPrisma.payment.findFirstOrThrow({
      where: { invoiceId: voidedInvoice.id },
    });
    await voidPayment(owner.agent, voidedPayment.id);

    const previous = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: previousMonthEnd,
      dueDate: previousMonthEnd,
      totalAmount: '200.000',
    });
    await createPayment(owner.agent, previous.id, {
      amount: '200.000',
      paymentDate: previousMonthEnd,
      method: 'BANK_TRANSFER',
    });

    const page = await owner.agent.get('/reports').expect(200);
    expect(page.text).toContain('Laporan bisnis');
    expect(page.text).toContain('Total tagihan diterbitkan');
    expect(page.text).toContain('Rp2.400.000');
    expect(page.text).toContain('Pembayaran diterima');
    expect(page.text).toContain('Rp1.000.000');
    expect(page.text).toContain('Sisa tagihan saat ini');
    expect(page.text).toContain('Rp1.400.000');
    expect(page.text).toContain('Rp200.000');
    expect(page.text).toContain('+400%');
    expect(page.text).toContain('4 tagihan aktif');
    expect(page.text).toContain('1 dibatalkan');
    expect(page.text).toContain('Lunas');
    expect(page.text).toContain('Sebagian');
  });

  it('menerapkan periode bulan sebelumnya, rentang custom, dan validasi tanggal', async () => {
    const { owner, rental } = await createBase(server, 'Rental Periode Laporan');

    await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: inDays(5),
      totalAmount: '1.000.000',
    });
    const previous = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: previousMonthEnd,
      dueDate: previousMonthEnd,
      totalAmount: '200.000',
    });
    await createPayment(owner.agent, previous.id, {
      amount: '200.000',
      paymentDate: previousMonthEnd,
      method: 'BANK_TRANSFER',
    });

    const lastMonth = await owner.agent.get('/reports?period=last_month').expect(200);
    expect(lastMonth.text).toContain('Bulan sebelumnya');
    expect(lastMonth.text).toMatch(/Total tagihan diterbitkan[\s\S]{0,300}Rp200\.000/);
    expect(lastMonth.text).not.toMatch(/Total tagihan diterbitkan[\s\S]{0,300}Rp1\.000\.000/);

    const custom = await owner.agent
      .get(`/reports?period=custom&from=${previousMonthStart}&to=${previousMonthEnd}`)
      .expect(200);
    expect(custom.text).toContain('Rentang tanggal khusus');
    expect(custom.text).toMatch(/Total tagihan diterbitkan[\s\S]{0,300}Rp200\.000/);

    const invalid = await owner.agent
      .get(`/reports?period=custom&from=${today}&to=${previousMonthEnd}`)
      .expect(200);
    expect(invalid.text).toContain('Tanggal akhir tidak boleh sebelum tanggal awal');

    const badExport = await owner.agent
      .get(`/reports/export/invoices?period=custom&from=${today}&to=${previousMonthEnd}`)
      .expect(400);
    expect(badExport.text).toContain('Tanggal akhir tidak boleh sebelum tanggal awal');
  });

  it('menampilkan laporan rental dengan filter, pencarian, dan pagination', async () => {
    const { owner, customer, rental } = await createBase(server, 'Rental Laporan Rental');
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: inDays(5),
      totalAmount: '1.000.000',
    });
    await createPayment(owner.agent, invoice.id, { amount: '300.000' });

    await testPrisma.rentalRecord.createMany({
      data: Array.from({ length: 11 }, (_, index) => ({
        businessId: owner.businessId,
        customerId: customer.id,
        rentalNumber: `RNT-RPT-${String(index + 1).padStart(2, '0')}`,
        itemName: `Barang laporan ${index + 1}`,
        startDate: new Date(`${thisMonthStart}T00:00:00.000Z`),
        endDate: new Date(`${today}T00:00:00.000Z`),
        price: 100_000,
        status: 'COMPLETED',
      })),
    });

    const storedRental = await testPrisma.rentalRecord.findUniqueOrThrow({
      where: { id: rental.id },
    });

    const page = await owner.agent.get('/reports?tab=rentals&period=this_month').expect(200);
    expect(page.text).toContain('Data penyewaan');
    expect(page.text).toContain('RNT-RPT-11');
    expect(page.text).toContain('Menampilkan');
    expect(page.text).toContain('12 penyewaan ditemukan');

    const filtered = await owner.agent
      .get(`/reports?tab=rentals&period=this_month&q=${storedRental.rentalNumber}&status=ACTIVE`)
      .expect(200);
    expect(filtered.text).toContain(storedRental.rentalNumber);
    expect(filtered.text).toContain('Rp1.000.000');
    expect(filtered.text).toContain('Rp700.000');
    expect(filtered.text).toContain('Total tagihan');
    expect(filtered.text).toContain('Sisa tagihan');
    expect(filtered.text).not.toContain('RNT-RPT-01');

    const pageTwo = await owner.agent
      .get('/reports?tab=rentals&period=this_month&page=2')
      .expect(200);
    expect(new Set(pageTwo.text.match(/RNT-00001|RNT-RPT-\d{2}/g) ?? []).size).toBe(2);
  });

  it('menampilkan laporan invoice dengan status, tanggal jatuh tempo, dan ringkasan', async () => {
    const { owner, rental } = await createBase(server, 'Rental Laporan Invoice');

    const partial = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: inDays(3),
      totalAmount: '1.000.000',
    });
    await createPayment(owner.agent, partial.id, { amount: '250.000' });

    const paid = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: inDays(3),
      totalAmount: '600.000',
    });
    await createPayment(owner.agent, paid.id, { amount: '600.000' });

    const unpaid = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: inDays(3),
      totalAmount: '400.000',
    });
    const cancelled = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: inDays(3),
      totalAmount: '200.000',
    });
    await cancelInvoice(owner.agent, cancelled.id);

    const stored = await testPrisma.invoice.findMany({
      where: { businessId: owner.businessId },
      orderBy: { invoiceNumber: 'asc' },
    });
    const numbers = Object.fromEntries(
      stored.map((invoice) => [invoice.id, invoice.invoiceNumber]),
    );

    const page = await owner.agent.get('/reports?tab=invoices&period=this_month').expect(200);
    expect(page.text).toContain('Laporan tagihan');
    expect(page.text).toContain('Rp2.000.000');
    expect(page.text).toContain(numbers[partial.id]);
    expect(page.text).toContain(numbers[paid.id]);
    expect(page.text).toContain(numbers[unpaid.id]);
    expect(page.text).toContain(numbers[cancelled.id]);

    const partialFilter = await owner.agent
      .get('/reports?tab=invoices&period=this_month&status=PARTIAL')
      .expect(200);
    expect(partialFilter.text).toContain(numbers[partial.id]);
    expect(partialFilter.text).not.toContain(numbers[paid.id]);

    const dueFilter = await owner.agent
      .get(`/reports?tab=invoices&period=this_month&dueFrom=${inDays(3)}&dueTo=${inDays(3)}`)
      .expect(200);
    expect(dueFilter.text).toContain(numbers[partial.id]);

    const invalidDue = await owner.agent
      .get(`/reports?tab=invoices&period=this_month&dueFrom=${inDays(5)}&dueTo=${inDays(3)}`)
      .expect(200);
    expect(invalidDue.text).toContain('Tanggal jatuh tempo akhir tidak boleh sebelum');
  });

  it('menampilkan laporan pembayaran dengan metode, void, dan filter status', async () => {
    const { owner, rental } = await createBase(server, 'Rental Laporan Pembayaran');
    const methods = [
      { method: 'CASH', total: '100.000' },
      { method: 'BANK_TRANSFER', total: '200.000' },
      { method: 'E_WALLET', total: '300.000' },
      { method: 'OTHER', total: '400.000' },
    ];

    for (const item of methods) {
      const invoice = await createInvoice(owner.agent, {
        rentalRecordId: rental.id,
        issueDate: thisMonthStart,
        dueDate: inDays(5),
        totalAmount: item.total,
      });
      await createPayment(owner.agent, invoice.id, {
        amount: item.total,
        paymentDate: today,
        method: item.method,
      });
    }

    const voidInvoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: inDays(5),
      totalAmount: '500.000',
    });
    await createPayment(owner.agent, voidInvoice.id, {
      amount: '100.000',
      paymentDate: today,
      method: 'E_WALLET',
    });
    const voidedPayment = await testPrisma.payment.findFirstOrThrow({
      where: { invoiceId: voidInvoice.id },
    });
    await voidPayment(owner.agent, voidedPayment.id);

    const page = await owner.agent.get('/reports?tab=payments&period=this_month').expect(200);
    expect(page.text).toContain('Pembayaran valid');
    expect(page.text).toContain('Rp1.000.000');
    expect(page.text).toContain('Tunai');
    expect(page.text).toContain('Transfer Bank');
    expect(page.text).toContain('E-Wallet');
    expect(page.text).toContain('Lainnya');
    expect(page.text).toContain('Dibatalkan');
    expect(page.text).toContain('Tidak dihitung sebagai uang diterima');

    const cash = await owner.agent
      .get('/reports?tab=payments&period=this_month&method=CASH')
      .expect(200);
    expect(cash.text).toContain('Rp100.000');

    const voidOnly = await owner.agent
      .get('/reports?tab=payments&period=this_month&status=void')
      .expect(200);
    expect(voidOnly.text).toContain('Rp100.000');
    expect(voidOnly.text).not.toContain('Rp600.000');
  });

  it('mengelompokkan piutang dan mengecualikan invoice lunas/dibatalkan', async () => {
    const { owner, rental } = await createBase(server, 'Rental Laporan Piutang');

    const dueFuture = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: inDays(5),
      totalAmount: '100.000',
    });
    const dueToday = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: today,
      totalAmount: '200.000',
    });
    const overdue7 = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: inDays(-3),
      dueDate: inDays(-3),
      totalAmount: '300.000',
    });
    const overdue30 = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: inDays(-10),
      dueDate: inDays(-10),
      totalAmount: '400.000',
    });
    const overduePlus = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: inDays(-40),
      dueDate: inDays(-40),
      totalAmount: '500.000',
    });
    const paid = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: today,
      totalAmount: '600.000',
    });
    await createPayment(owner.agent, paid.id, { amount: '600.000' });
    const cancelled = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: today,
      totalAmount: '700.000',
    });
    await cancelInvoice(owner.agent, cancelled.id);

    const page = await owner.agent.get('/reports?tab=receivables').expect(200);
    expect(page.text).toContain('Laporan piutang');
    expect(page.text).toContain('Belum jatuh tempo');
    expect(page.text).toContain('Jatuh tempo hari ini');
    expect(page.text).toContain('Terlambat 1–7 hari');
    expect(page.text).toContain('Terlambat 8–30 hari');
    expect(page.text).toContain('Terlambat lebih dari 30 hari');
    expect(page.text).toContain('40 hari');
    expect(page.text).toContain(dueFuture.id);
    expect(page.text).toContain(overduePlus.id);
    expect(page.text).not.toContain(paid.id);
    expect(page.text).not.toContain(cancelled.id);

    const oneGroup = await owner.agent
      .get('/reports?tab=receivables&aging=overdue_1_7')
      .expect(200);
    expect(oneGroup.text).toContain(overdue7.id);
    expect(oneGroup.text).not.toContain(overdue30.id);
    expect(oneGroup.text).not.toContain(dueToday.id);
  });

  it('menampilkan laporan reminder dan membedakan OPENED dengan SENT manual', async () => {
    const { owner, rental } = await createBase(server, 'Rental Laporan Reminder');
    const invoice = await createInvoice(owner.agent, {
      rentalRecordId: rental.id,
      issueDate: thisMonthStart,
      dueDate: inDays(3),
      totalAmount: '1.000.000',
    });
    await createPayment(owner.agent, invoice.id, { amount: '300.000' });
    await runReminders(owner.agent);

    const reminder = await testPrisma.reminderJob.findFirstOrThrow({
      where: { invoiceId: invoice.id, reminderType: 'H_MINUS_3' },
    });
    const detail = await owner.agent.get(`/reminders/${reminder.id}`).expect(200);
    await owner.agent
      .post(`/reminders/${reminder.id}/whatsapp`)
      .type('form')
      .send({ _csrf: extractCsrfToken(detail.text) })
      .expect(303);
    const afterOpen = await owner.agent.get(`/reminders/${reminder.id}`).expect(200);
    await owner.agent
      .post(`/reminders/${reminder.id}/marked-sent`)
      .type('form')
      .send({ _csrf: extractCsrfToken(afterOpen.text) })
      .expect(303);

    const page = await owner.agent.get('/reports?tab=reminders&period=this_month').expect(200);
    expect(page.text).toContain('Laporan pengingat');
    expect(page.text).toContain('Siap dihubungi');
    expect(page.text).toContain('Menunggu jadwal');
    expect(page.text).toContain('Dilewati');
    expect(page.text).toContain('WhatsApp dibuka');
    expect(page.text).toContain('Ditandai terkirim');
    expect(page.text).toContain('bukan bukti bahwa WhatsApp telah terkirim');
    const storedInvoice = await testPrisma.invoice.findUniqueOrThrow({
      where: { id: invoice.id },
    });
    expect(page.text).toContain(storedInvoice.invoiceNumber);
  });

  it('meng-export seluruh hasil filter CSV dengan BOM, escaping, dan isolasi tenant', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental CSV Laporan' });
    const customer = await createCustomer(owner.agent, {
      name: 'Pelanggan CSV',
      whatsappNumber: '081255570099',
    });
    await testPrisma.customer.update({
      where: { id: customer.id },
      data: { name: '=SUM(A1:A2), "QA"\nBaris 日本' },
    });
    const rental = await createRental(owner.agent, {
      customerId: customer.id,
      startDate: thisMonthStart,
      endDate: today,
      price: '100.000',
    });

    const invoices = [];
    for (let index = 1; index <= 12; index += 1) {
      invoices.push(
        await testPrisma.invoice.create({
          data: {
            businessId: owner.businessId,
            rentalRecordId: rental.id,
            invoiceNumber: `INV-RPT-${String(index).padStart(2, '0')}`,
            issueDate: new Date(`${thisMonthStart}T00:00:00.000Z`),
            dueDate: new Date(`${inDays(5)}T00:00:00.000Z`),
            totalAmount: 100_000,
          },
        }),
      );
    }

    await testPrisma.payment.create({
      data: {
        businessId: owner.businessId,
        invoiceId: invoices[0].id,
        amount: 100_000,
        paymentDate: new Date(`${today}T00:00:00.000Z`),
        method: 'BANK_TRANSFER',
        recordedByUserId: owner.userId,
      },
    });
    await testPrisma.payment.create({
      data: {
        businessId: owner.businessId,
        invoiceId: invoices[1].id,
        amount: 50_000,
        paymentDate: new Date(`${today}T00:00:00.000Z`),
        method: 'CASH',
        recordedByUserId: owner.userId,
        voidedAt: new Date(),
        voidReason: 'Pengujian CSV void',
        voidedByUserId: owner.userId,
      },
    });

    const response = await owner.agent
      .get('/reports/export/invoices?period=this_month')
      .expect(200);
    expect(response.headers['content-type']).toContain('text/csv');
    expect(response.headers['content-disposition']).toContain(`laporan-invoice-${today}.csv`);
    expect(response.text.startsWith('\uFEFF')).toBe(true);
    expect(response.text).toContain('Nomor Invoice');
    expect(response.text.match(/INV-RPT-\d{2}/g) ?? []).toHaveLength(12);
    expect(response.text).toContain("'=SUM(A1:A2)");
    expect(response.text).toContain('QA');
    expect(response.text).toContain('Baris 日本');
    expect(response.text).toContain('100000');

    const paidOnly = await owner.agent
      .get('/reports/export/invoices?period=this_month&status=PAID')
      .expect(200);
    expect(paidOnly.text).toContain('INV-RPT-01');
    expect(paidOnly.text).not.toContain('INV-RPT-02');
    expect(paidOnly.text).not.toContain('INV-RPT-12');

    for (const [type, header] of [
      ['rentals', 'Nomor Rental'],
      ['payments', 'Tanggal Pembayaran'],
      ['receivables', 'Hari Terlambat'],
      ['reminders', 'Jenis Reminder'],
    ] as const) {
      const exportResponse = await owner.agent
        .get(`/reports/export/${type}?period=this_month`)
        .expect(200);
      expect(exportResponse.text.startsWith('\uFEFF')).toBe(true);
      expect(exportResponse.text).toContain(header);
    }

    const payments = await owner.agent
      .get('/reports/export/payments?period=this_month')
      .expect(200);
    expect(payments.text).toContain('Void');
    expect(payments.text).toContain('Valid');

    const other = await registerTestUser(server, { businessName: 'Rental CSV Lain' });
    const otherExport = await other.agent
      .get('/reports/export/invoices?period=this_month')
      .expect(200);
    expect(otherExport.text).not.toContain('INV-RPT-01');

    await owner.agent.get('/reports?businessId=business-lain').expect(403);
    await owner.agent.get('/reports/export/invoices?businessId=business-lain').expect(403);

    const invalidCustom = await owner.agent
      .get(`/reports/export/invoices?period=custom&from=${today}&to=${previousMonthEnd}`)
      .expect(400);
    expect(invalidCustom.text).toContain('Tanggal akhir tidak boleh sebelum tanggal awal');
  });
});
