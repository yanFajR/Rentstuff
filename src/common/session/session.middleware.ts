import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import expressSession from 'express-session';
import { PrismaService } from '../prisma/prisma.service.js';
import { PrismaSessionStore } from './prisma-session.store.js';

const DEFAULT_SESSION_TTL_MS = 8 * 60 * 60 * 1_000;

@Injectable()
export class SessionMiddleware implements NestMiddleware {
  private readonly handler: RequestHandler;

  constructor(configService: ConfigService, prisma: PrismaService) {
    const ttlMs = configService.get<number>('session.ttlMs') ?? DEFAULT_SESSION_TTL_MS;
    const secret = configService.get<string>('session.secret') ?? '';
    const name = configService.get<string>('session.name') ?? 'rental_reminder.sid';
    const cookieSecure = configService.get<boolean>('session.cookieSecure') ?? false;

    this.handler = expressSession({
      name,
      secret,
      store: new PrismaSessionStore(prisma, ttlMs),
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: cookieSecure,
        maxAge: ttlMs,
        path: '/',
      },
    });
  }

  use(request: Request, response: Response, next: NextFunction): void {
    this.handler(request, response, next);
  }
}
