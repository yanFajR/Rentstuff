import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { configureApplication } from './app.setup.js';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  configureApplication(app);
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = configService.get<number>('app.port') ?? 3000;
  const appUrl = configService.get<string>('app.url') ?? `http://localhost:${port}`;
  const environment = configService.get<string>('app.environment') ?? 'development';
  const databaseProvider = configService.get<string>('database.provider') ?? 'unknown';

  if (environment === 'production') {
    if (databaseProvider !== 'sqlite') {
      throw new Error('Tahap 7 hanya mendukung database SQLite.');
    }

    const sessionSecret = process.env.SESSION_SECRET ?? '';
    if (sessionSecret === 'ganti-dengan-secret-acak-minimal-32-karakter') {
      throw new Error('SESSION_SECRET masih memakai nilai contoh. Ganti dengan secret acak.');
    }

    const cookieSecure = configService.get<boolean>('session.cookieSecure') ?? false;
    if (appUrl.startsWith('https://') && !cookieSecure) {
      throw new Error(
        'SESSION_COOKIE_SECURE harus true ketika APP_URL production menggunakan HTTPS.',
      );
    }
  }

  await app.listen(port);

  logger.log(`Rental Reminder berjalan di ${appUrl} (${environment})`);
  logger.log(`Health liveness tersedia di ${appUrl}/health`);
  logger.log(`Health readiness tersedia di ${appUrl}/health/ready`);
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack : String(error);
  Logger.error(message, 'Bootstrap');
  process.exitCode = 1;
});
