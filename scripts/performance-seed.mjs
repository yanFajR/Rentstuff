import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire('D:/LAB/Rental/package.json');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

if (typeof process.loadEnvFile === 'function' && existsSync('.env')) {
  process.loadEnvFile('.env');
}

if (
  process.env.NODE_ENV === 'production' &&
  process.env.PERFORMANCE_ALLOW_PRODUCTION !== '1'
) {
  console.error('Seed performance menolak production tanpa PERFORMANCE_ALLOW_PRODUCTION=1.');
  process.exit(1);
}

const prisma = new PrismaClient();
const start = performance.now();

function dateOnly(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function todayJakarta() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type) => parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function addDays(value, days) {
  const date = dateOnly(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function randomBetween(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function createBatches(model, rows, size = 100) {
  for (let index = 0; index < rows.length; index += size) {
    await model.createMany({ data: rows.slice(index, index + size) });
  }
}

async function main() {
  const email = 'perf.owner@example.com';
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    const membership = await prisma.businessMember.findFirst({ where: { userId: existing.id } });
    if (membership) {
      await prisma.business.delete({ where: { id: membership.businessId } });
    }
    await prisma.user.delete({ where: { id: existing.id } });
  }

  const today = todayJakarta();
  const userId = randomUUID();
  const businessId = randomUUID();
  const passwordHash = await bcrypt.hash('Rahasia123', 12);

  await prisma.user.create({
    data: { id: userId, name: 'Perf Owner', email, passwordHash },
  });
  await prisma.business.create({
    data: {
      id: businessId,
      name: 'Rental Performance QA',
      members: { create: { userId, role: 'OWNER' } },
    },
  });

  const customers = Array.from({ length: 1000 }, (_, index) => ({
    id: randomUUID(),
    businessId,
    name: `Pelanggan Performance ${String(index + 1).padStart(4, '0')}`,
    whatsappNumber: `62812${String(70000000 + index).slice(-8)}`,
    createdAt: new Date(Date.now() - index * 60_000),
  }));
  await createBatches(prisma.customer, customers);
  console.log(`customers: ${customers.length}`);

  const rentals = Array.from({ length: 5000 }, (_, index) => {
    const startDate = randomBetween(-120, 20);
    return {
      id: randomUUID(),
      businessId,
      customerId: customers[index % customers.length].id,
      rentalNumber: `RNT-PERF-${String(index + 1).padStart(5, '0')}`,
      itemName: `Barang Performance ${index + 1}`,
      startDate: dateOnly(addDays(today, startDate)),
      endDate: dateOnly(addDays(today, startDate + randomBetween(1, 10))),
      price: randomBetween(1, 10) * 100_000,
      status: index % 11 === 0 ? 'CANCELLED' : index % 3 === 0 ? 'COMPLETED' : 'ACTIVE',
    };
  });
  await createBatches(prisma.rentalRecord, rentals);
  console.log(`rentals: ${rentals.length}`);

  const invoices = Array.from({ length: 10_000 }, (_, index) => {
    const issueOffset = randomBetween(-90, 0);
    const paidInFull = index % 10 === 0;
    return {
      id: randomUUID(),
      businessId,
      rentalRecordId: rentals[index % rentals.length].id,
      invoiceNumber: `INV-PERF-${String(index + 1).padStart(5, '0')}`,
      issueDate: dateOnly(addDays(today, issueOffset)),
      dueDate: dateOnly(addDays(today, issueOffset + 30)),
      totalAmount: paidInFull ? 150_000 : 500_000,
    };
  });
  await createBatches(prisma.invoice, invoices);
  console.log(`invoices: ${invoices.length}`);

  const payments = [];
  for (const invoice of invoices) {
    const paymentDate = dateOnly(addDays(today, randomBetween(-30, 0)));
    payments.push({
      id: randomUUID(),
      businessId,
      invoiceId: invoice.id,
      amount: 100_000,
      paymentDate,
      method: 'BANK_TRANSFER',
      reference: `PERF-${invoice.invoiceNumber}-A`,
      recordedByUserId: userId,
    });
    payments.push({
      id: randomUUID(),
      businessId,
      invoiceId: invoice.id,
      amount: 50_000,
      paymentDate,
      method: ['CASH', 'E_WALLET', 'OTHER'][randomBetween(0, 2)],
      reference: `PERF-${invoice.invoiceNumber}-B`,
      recordedByUserId: userId,
    });
  }
  await createBatches(prisma.payment, payments, 100);
  console.log(`payments: ${payments.length}`);

  const reminderJobs = Array.from({ length: 10_000 }, (_, index) => {
    const invoice = invoices[index];
    const scheduledOffset = index % 4;
    return {
      id: randomUUID(),
      businessId,
      invoiceId: invoice.id,
      reminderType: 'H_MINUS_3',
      scheduledDate: dateOnly(addDays(today, scheduledOffset)),
      status: ['PENDING', 'READY', 'SKIPPED'][index % 3],
      processedAt: index % 3 === 1 ? new Date() : null,
      skippedAt: index % 3 === 2 ? new Date() : null,
      skipReason: index % 3 === 2 ? 'Invoice sudah lunas.' : null,
    };
  });
  await createBatches(prisma.reminderJob, reminderJobs);
  console.log(`reminderJobs: ${reminderJobs.length}`);

  const activities = [];
  for (const job of reminderJobs) {
    activities.push({
      id: randomUUID(),
      businessId,
      reminderId: job.id,
      userId: null,
      activityType: 'CREATED',
      notes: 'Dibuat otomatis oleh scheduler.',
      createdAt: new Date(Date.now() - randomBetween(0, 30) * 60_000),
    });
    activities.push({
      id: randomUUID(),
      businessId,
      reminderId: job.id,
      userId,
      activityType: 'WHATSAPP_OPENED',
      notes: 'Link WhatsApp dibuka.',
      createdAt: new Date(Date.now() - randomBetween(0, 30) * 60_000),
    });
    activities.push({
      id: randomUUID(),
      businessId,
      reminderId: job.id,
      userId,
      activityType: 'MARKED_SENT',
      notes: 'Ditandai terkirim manual.',
      createdAt: new Date(Date.now() - randomBetween(0, 30) * 60_000),
    });
  }
  await createBatches(prisma.reminderActivity, activities, 100);
  console.log(`reminderActivities: ${activities.length}`);

  console.log(
    JSON.stringify(
      {
        email,
        password: 'Rahasia123',
        businessId,
        customers: customers.length,
        rentals: rentals.length,
        invoices: invoices.length,
        payments: payments.length,
        reminderJobs: reminderJobs.length,
        reminderActivities: activities.length,
        durationSeconds: Math.round((performance.now() - start) / 1000),
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
