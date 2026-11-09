import { randomBytes, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';

const TOKEN_BYTES = 32;

@Injectable()
export class CsrfService {
  createToken(): string {
    return randomBytes(TOKEN_BYTES).toString('hex');
  }

  ensureToken(request: Request): string {
    if (!request.session.csrfToken) {
      request.session.csrfToken = this.createToken();
    }
    return request.session.csrfToken;
  }

  rotateToken(request: Request): string {
    request.session.csrfToken = this.createToken();
    return request.session.csrfToken;
  }

  isValid(request: Request, providedToken: unknown): boolean {
    const expectedToken = request.session?.csrfToken;
    if (!expectedToken || typeof providedToken !== 'string' || providedToken.length === 0) {
      return false;
    }

    const expected = Buffer.from(expectedToken, 'utf8');
    const provided = Buffer.from(providedToken, 'utf8');

    if (expected.length !== provided.length) {
      return false;
    }

    return timingSafeEqual(expected, provided);
  }
}
