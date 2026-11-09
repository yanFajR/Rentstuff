import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type RentalRecord } from '@prisma/client';

import { buildPagination, type Pagination } from '../common/helpers/pagination.js';
import { PrismaService } from '../common/prisma/prisma.service.js';
import { CustomerService } from '../customers/customer.service.js';
import {
  canTransitionRentalStatus,
  formatRentalNumber,
  isRentalStatus,
  type RentalStatus,
} from './rental-status.js';

export const RENTAL_SORTS = ['created_desc', 'created_asc', 'start_desc', 'start_asc'] as const;
export type RentalSort = (typeof RENTAL_SORTS)[number];

export type RentalListItem = Prisma.RentalRecordGetPayload<{
  include: { customer: { select: { id: true; name: true; whatsappNumber: true } } };
}>;

export type RentalDetail = Prisma.RentalRecordGetPayload<{
  include: {
    customer: {
      select: {
        id: true;
        name: true;
        whatsappNumber: true;
        email: true;
        address: true;
        archivedAt: true;
      };
    };
    invoices: {
      include: {
        payments: { select: { amount: true; voidedAt: true } };
      };
    };
  };
}>;

const MAX_NUMBER_ATTEMPTS = 5;

export interface RentalListOptions {
  businessId: string;
  search: string;
  status: RentalStatus | null;
  from: Date | null;
  to: Date | null;
  sort: RentalSort;
  page: number;
  perPage: number;
}

export interface RentalInput {
  customerId: string;
  itemName: string;
  startDate: Date;
  endDate: Date;
  price: number;
  notes?: string;
}

export class CustomerNotAvailableError extends Error {
  constructor() {
    super('Pelanggan tidak ditemukan atau sudah diarsipkan.');
    this.name = 'CustomerNotAvailableError';
  }
}

function orderByFor(sort: RentalSort): Prisma.RentalRecordOrderByWithRelationInput {
  switch (sort) {
    case 'created_asc':
      return { createdAt: 'asc' };
    case 'start_desc':
      return { startDate: 'desc' };
    case 'start_asc':
      return { startDate: 'asc' };
    case 'created_desc':
    default:
      return { createdAt: 'desc' };
  }
}

function optionalText(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

@Injectable()
export class RentalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly customerService: CustomerService,
  ) {}

  async list(
    options: RentalListOptions,
  ): Promise<{ rentals: RentalListItem[]; pagination: Pagination }> {
    const where: Prisma.RentalRecordWhereInput = { businessId: options.businessId };

    if (options.status) {
      where.status = options.status;
    }

    if (options.from || options.to) {
      where.startDate = {
        ...(options.from ? { gte: options.from } : {}),
        ...(options.to ? { lte: options.to } : {}),
      };
    }

    if (options.search.length > 0) {
      where.OR = [
        { rentalNumber: { contains: options.search } },
        { itemName: { contains: options.search } },
        { customer: { name: { contains: options.search } } },
      ];
    }

    const total = await this.prisma.rentalRecord.count({ where });
    const pagination = buildPagination(options.page, total, options.perPage);
    const rentals = await this.prisma.rentalRecord.findMany({
      where,
      orderBy: orderByFor(options.sort),
      skip: (pagination.page - 1) * pagination.perPage,
      take: pagination.perPage,
      include: {
        customer: { select: { id: true, name: true, whatsappNumber: true } },
      },
    });

    return { rentals, pagination };
  }

  async getById(businessId: string, rentalId: string): Promise<RentalDetail> {
    const rental = await this.prisma.rentalRecord.findFirst({
      where: { id: rentalId, businessId },
      include: {
        customer: {
          select: {
            id: true,
            name: true,
            whatsappNumber: true,
            email: true,
            address: true,
            archivedAt: true,
          },
        },
        invoices: {
          orderBy: { createdAt: 'desc' },
          include: {
            payments: { select: { amount: true, voidedAt: true } },
          },
        },
      },
    });

    if (!rental) {
      throw new NotFoundException('Penyewaan tidak ditemukan pada bisnis ini.');
    }

    return rental;
  }

  async create(businessId: string, input: RentalInput): Promise<RentalRecord> {
    for (let attempt = 1; attempt <= MAX_NUMBER_ATTEMPTS; attempt += 1) {
      try {
        return await this.prisma.$transaction(async (transaction) => {
          const customer = await transaction.customer.findFirst({
            where: { id: input.customerId, businessId, archivedAt: null },
            select: { id: true },
          });

          if (!customer) {
            throw new CustomerNotAvailableError();
          }

          const sequence = await transaction.rentalRecord.count({ where: { businessId } });

          return await transaction.rentalRecord.create({
            data: {
              businessId,
              customerId: input.customerId,
              rentalNumber: formatRentalNumber(sequence + 1),
              itemName: input.itemName.trim(),
              startDate: input.startDate,
              endDate: input.endDate,
              price: input.price,
              notes: optionalText(input.notes),
              status: 'ACTIVE',
            },
          });
        });
      } catch (error) {
        if (isUniqueConstraintError(error)) {
          if (attempt < MAX_NUMBER_ATTEMPTS) {
            continue;
          }
          break;
        }
        throw error;
      }
    }

    throw new BadRequestException(
      'Nomor transaksi tidak dapat dibuat saat ini. Silakan coba lagi.',
    );
  }

  async update(businessId: string, rentalId: string, input: RentalInput): Promise<void> {
    const rental = await this.getById(businessId, rentalId);

    if (rental.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Transaksi hanya dapat diubah saat berstatus aktif. Transaksi selesai atau dibatalkan bersifat final.',
      );
    }

    const customer = await this.customerService.findActiveById(businessId, input.customerId);
    if (!customer) {
      throw new CustomerNotAvailableError();
    }

    await this.prisma.rentalRecord.update({
      where: { id: rental.id },
      data: {
        customerId: input.customerId,
        itemName: input.itemName.trim(),
        startDate: input.startDate,
        endDate: input.endDate,
        price: input.price,
        notes: optionalText(input.notes),
      },
    });
  }

  async changeStatus(
    businessId: string,
    rentalId: string,
    targetStatus: RentalStatus,
  ): Promise<void> {
    const rental = await this.getById(businessId, rentalId);

    if (!isRentalStatus(rental.status) || !canTransitionRentalStatus(rental.status, targetStatus)) {
      throw new BadRequestException(
        'Perubahan status transaksi tidak valid untuk status saat ini.',
      );
    }

    await this.prisma.rentalRecord.update({
      where: { id: rental.id },
      data: { status: targetStatus },
    });
  }
}
