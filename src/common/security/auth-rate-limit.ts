import { HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { rateLimit, type RateLimitRequestHandler } from 'express-rate-limit';

export function createRateLimiter(
  configService: ConfigService,
  limitKey: string,
  windowKey: string,
  skipSuccessfulRequests: boolean,
  message: string,
): RateLimitRequestHandler {
  return rateLimit({
    windowMs: configService.get<number>(windowKey) ?? 15 * 60 * 1_000,
    limit: configService.get<number>(limitKey) ?? 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests,
    handler: (_request, _response, next) => {
      next(new HttpException(message, HttpStatus.TOO_MANY_REQUESTS));
    },
  });
}

export function createAuthRateLimiter(
  configService: ConfigService,
  limitKey: string,
  windowKey: string,
  skipSuccessfulRequests: boolean,
): RateLimitRequestHandler {
  return createRateLimiter(
    configService,
    limitKey,
    windowKey,
    skipSuccessfulRequests,
    'Terlalu banyak percobaan. Silakan coba lagi beberapa saat lagi.',
  );
}
