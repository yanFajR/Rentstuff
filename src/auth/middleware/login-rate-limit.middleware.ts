import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import type { RateLimitRequestHandler } from 'express-rate-limit';
import { createAuthRateLimiter } from '../../common/security/auth-rate-limit.js';

@Injectable()
export class LoginRateLimitMiddleware implements NestMiddleware {
  private readonly limiter: RateLimitRequestHandler;

  constructor(configService: ConfigService) {
    this.limiter = createAuthRateLimiter(
      configService,
      'security.loginRateLimit',
      'security.loginRateWindowMs',
      true,
    );
  }

  use(request: Request, response: Response, next: NextFunction): void {
    this.limiter(request, response, next);
  }
}
