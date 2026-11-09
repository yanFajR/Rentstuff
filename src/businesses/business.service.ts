import { Injectable } from '@nestjs/common';
import { normalizeWhatsAppNumber } from '../common/helpers/whatsapp.js';
import { PrismaService } from '../common/prisma/prisma.service.js';

export interface UpdateBusinessProfileInput {
  businessId: string;
  userId: string;
  businessName: string;
  ownerName: string;
  whatsappNumber?: string;
  address?: string;
  description?: string;
}

function toNullableText(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class BusinessService {
  constructor(private readonly prisma: PrismaService) {}

  async updateProfile(input: UpdateBusinessProfileInput): Promise<void> {
    const whatsappNumber = input.whatsappNumber
      ? normalizeWhatsAppNumber(input.whatsappNumber)
      : null;

    await this.prisma.$transaction([
      this.prisma.business.update({
        where: { id: input.businessId },
        data: {
          name: input.businessName.trim(),
          whatsappNumber,
          address: toNullableText(input.address),
          description: toNullableText(input.description),
        },
      }),
      this.prisma.user.update({
        where: { id: input.userId },
        data: { name: input.ownerName.trim() },
      }),
    ]);
  }
}
