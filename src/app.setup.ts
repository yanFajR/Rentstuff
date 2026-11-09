import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

const SEVEN_DAYS_IN_MS = 7 * 24 * 60 * 60 * 1_000;
const MODULE_DIRECTORY = fileURLToPath(new URL('.', import.meta.url));

function resolveViewsDirectory(isProduction: boolean): string {
  return isProduction ? join(MODULE_DIRECTORY, 'views') : join(process.cwd(), 'src', 'views');
}

export function configureApplication(app: NestExpressApplication): void {
  const configService = app.get(ConfigService);
  const environment = configService.get<string>('app.environment') ?? 'development';
  const isProduction = environment === 'production';
  const appUrl = configService.get<string>('app.url') ?? '';
  const useHsts = isProduction && appUrl.startsWith('https://');

  app.disable('x-powered-by');
  app.set('trust proxy', isProduction ? 1 : false);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'base-uri': ["'self'"],
          'connect-src': ["'self'"],
          'font-src': ["'self'"],
          'form-action': ["'self'"],
          'frame-ancestors': ["'none'"],
          'img-src': ["'self'", 'data:'],
          'object-src': ["'none'"],
          'script-src': ["'self'"],
          'style-src': ["'self'"],
          'upgrade-insecure-requests': null,
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'same-origin' },
      xFrameOptions: { action: 'deny' },
      strictTransportSecurity: useHsts
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: false }
        : false,
    }),
  );

  app.use((_request: Request, response: Response, next: NextFunction) => {
    response.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), payment=()',
    );
    next();
  });

  app.useStaticAssets(join(process.cwd(), 'public'), {
    prefix: '/assets',
    maxAge: isProduction ? SEVEN_DAYS_IN_MS : 0,
  });

  app.useStaticAssets(join(process.cwd(), 'node_modules', 'htmx.org', 'dist'), {
    prefix: '/vendor/htmx',
    maxAge: isProduction ? SEVEN_DAYS_IN_MS : 0,
  });

  app.setBaseViewsDir(resolveViewsDirectory(isProduction));
  app.setViewEngine('ejs');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}
