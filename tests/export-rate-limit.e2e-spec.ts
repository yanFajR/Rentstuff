import type { NestExpressApplication } from '@nestjs/platform-express';

import { registerTestUser, testPrisma } from './utils/auth.js';
import { createTestApplication } from './utils/create-app.js';

describe('Rate limit export CSV (e2e)', () => {
  let app: NestExpressApplication;
  let server: ReturnType<NestExpressApplication['getHttpServer']>;
  const previousLimit = process.env.REPORT_EXPORT_RATE_LIMIT;
  const previousWindow = process.env.REPORT_EXPORT_RATE_WINDOW_MS;

  beforeAll(async () => {
    process.env.REPORT_EXPORT_RATE_LIMIT = '1';
    process.env.REPORT_EXPORT_RATE_WINDOW_MS = '60000';
    app = await createTestApplication();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
    await testPrisma.$disconnect();
    if (previousLimit === undefined) {
      delete process.env.REPORT_EXPORT_RATE_LIMIT;
    } else {
      process.env.REPORT_EXPORT_RATE_LIMIT = previousLimit;
    }
    if (previousWindow === undefined) {
      delete process.env.REPORT_EXPORT_RATE_WINDOW_MS;
    } else {
      process.env.REPORT_EXPORT_RATE_WINDOW_MS = previousWindow;
    }
  });

  it('membatasi export CSV setelah batas tercapai', async () => {
    const owner = await registerTestUser(server, { businessName: 'Rental Export Limit' });

    const first = await owner.agent.get('/reports/export/invoices?period=this_month');
    expect(first.status).toBe(200);

    const second = await owner.agent.get('/reports/export/invoices?period=this_month').expect(429);
    expect(second.text).toContain('Terlalu banyak permintaan export');
  });
});
