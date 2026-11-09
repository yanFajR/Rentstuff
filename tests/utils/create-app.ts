import { Test } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from '../../src/app.module.js';
import { configureApplication } from '../../src/app.setup.js';

export async function createTestApplication(): Promise<NestExpressApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    logger: process.env.E2E_LOGS === '1' ? ['error', 'warn'] : false,
  });
  configureApplication(app);
  await app.init();
  return app;
}
