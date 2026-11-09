import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import { createRateLimiter } from './auth-rate-limit.js';

@Injectable()
export class ExportRateLimitMiddleware implements NestMiddleware {
  private readonly limiter: RateLimitRequestHandler;

  constructor(configService: ConfigService) {
    this.limiter = createRateLimiter(
      configService,
      'security.exportRateLimit',
      'security.exportRateWindowMs',
      false,
      'Terlalu banyak permintaan export. Silakan coba lagi beberapa saat lagi.',
    );
  }

  use(request: Request, response: Response, next: NextFunction): void {
    this.limiter(request, response, next);
  }
}
