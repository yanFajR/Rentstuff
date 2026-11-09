import {
  ForbiddenException,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request } from 'express';
import { CsrfService } from './csrf.service.js';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(private readonly csrfService: CsrfService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();

    if (SAFE_METHODS.has(request.method)) {
      return true;
    }

    const bodyToken =
      typeof request.body === 'object' && request.body !== null
        ? (request.body as Record<string, unknown>)._csrf
        : undefined;
    const headerToken = request.headers['x-csrf-token'];
    const providedToken = bodyToken ?? headerToken;

    if (!this.csrfService.isValid(request, providedToken)) {
      throw new ForbiddenException(
        'Sesi keamanan tidak valid atau sudah kedaluwarsa. Muat ulang halaman lalu coba lagi.',
      );
    }

    return true;
  }
}
