import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BUSINESS_ROLES } from '../common/auth/business-role.js';
import { normalizeEmail } from '../common/helpers/email.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { PasswordService } from './password.service.js';

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  businessName: string;
}

export interface RegisterResult {
  userId: string;
  businessId: string;
}

export type LoginResult =
  | {
      status: 'success';
      userId: string;
      businessId: string;
      userName: string;
      businessName: string;
      role: string;
    }
  | { status: 'invalid' }
  | { status: 'inactive' }
  | { status: 'no-business' };

export class EmailAlreadyRegisteredError extends Error {
  constructor() {
    super('Email sudah terdaftar.');
    this.name = 'EmailAlreadyRegisteredError';
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly passwordService: PasswordService,
  ) {}

  async register(input: RegisterInput): Promise<RegisterResult> {
    const email = normalizeEmail(input.email);
    const passwordHash = await this.passwordService.hash(input.password);

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.create({
          data: {
            name: input.name.trim(),
            email,
            passwordHash,
          },
        });

        const business = await transaction.business.create({
          data: {
            name: input.businessName.trim(),
          },
        });

        await transaction.businessMember.create({
          data: {
            userId: user.id,
            businessId: business.id,
            role: BUSINESS_ROLES.OWNER,
          },
        });

        return { userId: user.id, businessId: business.id };
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new EmailAlreadyRegisteredError();
      }
      throw error;
    }
  }

  async authenticate(emailInput: string, password: string): Promise<LoginResult> {
    const email = normalizeEmail(emailInput);

    const user = await this.prisma.user.findUnique({
      where: { email },
      include: {
        memberships: {
          include: { business: true },
          orderBy: { createdAt: 'asc' },
          take: 1,
        },
      },
    });

    if (!user) {
      await this.passwordService.runTimingEqualizer(password);
      return { status: 'invalid' };
    }

    const passwordMatches = await this.passwordService.verify(user.passwordHash, password);
    if (!passwordMatches) {
      return { status: 'invalid' };
    }

    if (!user.isActive) {
      return { status: 'inactive' };
    }

    const membership = user.memberships[0];
    if (!membership) {
      return { status: 'no-business' };
    }

    return {
      status: 'success',
      userId: user.id,
      businessId: membership.businessId,
      userName: user.name,
      businessName: membership.business.name,
      role: membership.role,
    };
  }
}
