import {
  ForbiddenException,
  HttpStatus,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';
import { SessionService } from '../session/session.service.js';
import type { AuthenticatedRequest } from './authenticated-request.js';

export function buildInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter((part) => part.length > 0)
    .slice(0, 2);

  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '?';
}

@Injectable()
export class TenantAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessionService: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();

    const userId = request.session?.userId;
    const businessId = request.session?.businessId;

    if (!userId || !businessId) {
      this.redirectToLogin(request, response);
      return false;
    }

    if (this.containsInjectedBusinessId(request)) {
      throw new ForbiddenException(
        'Parameter businessId dari request tidak diizinkan. Identitas bisnis diambil dari sesi Anda.',
      );
    }

    const membership = await this.prisma.businessMember.findUnique({
      where: { businessId_userId: { businessId, userId } },
      include: { user: true, business: true },
    });

    if (!membership || !membership.user.isActive) {
      await this.sessionService.terminate(request, response);
      this.redirectToLogin(request, response);
      return false;
    }

    request.auth = {
      userId: membership.userId,
      businessId: membership.businessId,
      membershipId: membership.id,
      role: membership.role,
      user: {
        id: membership.user.id,
        name: membership.user.name,
        email: membership.user.email,
      },
      business: {
        id: membership.business.id,
        name: membership.business.name,
        address: membership.business.address,
        whatsappNumber: membership.business.whatsappNumber,
        description: membership.business.description,
      },
      membership,
    };

    response.locals.currentUser = {
      id: membership.user.id,
      name: membership.user.name,
      email: membership.user.email,
      initials: buildInitials(membership.user.name),
    };
    response.locals.currentBusiness = {
      id: membership.business.id,
      name: membership.business.name,
      role: membership.role,
    };

    return true;
  }

  private containsInjectedBusinessId(request: Request): boolean {
    const sources: unknown[] = [request.body, request.query, request.params];

    return sources.some((source) => {
      if (typeof source !== 'object' || source === null) {
        return false;
      }
      const record = source as Record<string, unknown>;
      return 'businessId' in record || 'business_id' in record;
    });
  }

  private redirectToLogin(request: Request, response: Response): void {
    if (request.headers['hx-request'] === 'true') {
      response.setHeader('HX-Redirect', '/login');
      response.status(HttpStatus.UNAUTHORIZED).end();
      return;
    }

    response.redirect(HttpStatus.FOUND, '/login');
  }
}
