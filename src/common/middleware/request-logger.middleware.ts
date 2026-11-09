import { Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from '@nestjs/common';

const IGNORED_PREFIXES = ['/assets', '/vendor', '/favicon.ico'];

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(request: Request, response: Response, next: NextFunction): void {
    if (IGNORED_PREFIXES.some((prefix) => request.originalUrl.startsWith(prefix))) {
      next();
      return;
    }

    const startedAt = process.hrtime.bigint();
    const path = request.originalUrl.split('?')[0] ?? request.path;

    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      this.logger.log(
        `${request.method} ${path} ${response.statusCode} - ${durationMs.toFixed(1)}ms`,
      );
    });

    next();
  }
}
