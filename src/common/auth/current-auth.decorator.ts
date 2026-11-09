import { UnauthorizedException, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticationContext, AuthenticatedRequest } from './authenticated-request.js';

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticationContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) {
      throw new UnauthorizedException('Anda harus masuk terlebih dahulu.');
    }
    return request.auth;
  },
);
