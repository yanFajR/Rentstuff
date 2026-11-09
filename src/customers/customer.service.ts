import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Customer } from '@prisma/client';

import { normalizeEmail } from '../common/helpers/email.js';
import { buildPagination, type Pagination } from '../common/helpers/pagination.js';
import { normalizeWhatsAppNumber } from '../common/helpers/whatsapp.js';
import { PrismaService } from '../common/prisma/prisma.service.js';

export type CustomerListItem = Prisma.CustomerGetPayload<{
  include: { _count: { select: { rentals: true } } };
}>;

export type CustomerDetail = Prisma.CustomerGetPayload<{
  include: { _count: { select: { rentals: true } }; rentals: true };
}>;

export type CustomerInvoiceRow = Prisma.InvoiceGetPayload<{
  include: {
    rentalRecord: { select: { id: true; rentalNumber: true } };
    payments: { select: { amount: true; voidedAt: true } };
  };
}>;

export interface SelectableCustomer {
  id: string;
  name: string;
  whatsappNumber: string;
}

export const CUSTOMER_SORTS = ['created_desc', 'created_asc', 'name_asc', 'name_desc'] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

export interface CustomerListOptions {
  businessId: string;
  search: string;
  sort: CustomerSort;
  page: number;
  perPage: number;
}

export interface CustomerFormInput {
  name: string;
  whatsappNumber: string;
  email?: string;
  address?: string;
  notes?: string;
}

function orderByFor(sort: CustomerSort): Prisma.CustomerOrderByWithRelationInput {
  switch (sort) {
    case 'created_asc':
      return { createdAt: 'asc' };
    case 'name_asc':
      return { name: 'asc' };
    case 'name_desc':
      return { name: 'desc' };
    case 'created_desc':
    default:
      return { createdAt: 'desc' };
  }
}

function searchConditions(search: string): Prisma.CustomerWhereInput[] {
  const conditions: Prisma.CustomerWhereInput[] = [{ name: { contains: search } }];
  const digits = search.replace(/\D/g, '');

  if (digits.length > 0) {
    conditions.push({ whatsappNumber: { contains: digits } });
    const normalized = normalizeWhatsAppNumber(digits);
    if (normalized && normalized !== digits) {
      conditions.push({ whatsappNumber: { contains: normalized } });
    }
  }

  return conditions;
}

function optionalText(value: string | undefined): string | null {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

@Injectable()
export class CustomerService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    options: CustomerListOptions,
  ): Promise<{ customers: CustomerListItem[]; pagination: Pagination }> {
    const where: Prisma.CustomerWhereInput = { businessId: options.businessId };

    if (options.search.length > 0) {
      where.OR = searchConditions(options.search);
    }

    const total = await this.prisma.customer.count({ where });
    const pagination = buildPagination(options.page, total, options.perPage);
    const customers = await this.prisma.customer.findMany({
      where,
      orderBy: orderByFor(options.sort),
      skip: (pagination.page - 1) * pagination.perPage,
      take: pagination.perPage,
      include: {
        _count: { select: { rentals: true } },
      },
    });

    return { customers, pagination };
  }

  async getSelectable(businessId: string): Promise<SelectableCustomer[]> {
    return this.prisma.customer.findMany({
      where: { businessId, archivedAt: null },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, whatsappNumber: true },
    });
  }

  async findActiveById(businessId: string, customerId: string): Promise<SelectableCustomer | null> {
    return this.prisma.customer.findFirst({
      where: { id: customerId, businessId, archivedAt: null },
      select: { id: true, name: true, whatsappNumber: true },
    });
  }

  async getById(businessId: string, customerId: string): Promise<CustomerDetail> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, businessId },
      include: {
        _count: { select: { rentals: true } },
        rentals: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!customer) {
      throw new NotFoundException('Pelanggan tidak ditemukan pada bisnis ini.');
    }

    return customer;
  }

  async getInvoicesForCustomer(
    businessId: string,
    customerId: string,
  ): Promise<CustomerInvoiceRow[]> {
    return this.prisma.invoice.findMany({
      where: { businessId, rentalRecord: { customerId } },
      orderBy: { createdAt: 'desc' },
      include: {
        rentalRecord: { select: { id: true, rentalNumber: true } },
        payments: { select: { amount: true, voidedAt: true } },
      },
    });
  }

  async create(businessId: string, input: CustomerFormInput): Promise<Customer> {
    const whatsappNumber = normalizeWhatsAppNumber(input.whatsappNumber);
    if (!whatsappNumber) {
      throw new BadRequestException('Nomor WhatsApp tidak valid.');
    }

    return this.prisma.customer.create({
      data: {
        businessId,
        name: input.name.trim(),
        whatsappNumber,
        email: input.email ? normalizeEmail(input.email) : null,
        address: optionalText(input.address),
        notes: optionalText(input.notes),
      },
    });
  }

  async update(businessId: string, customerId: string, input: CustomerFormInput): Promise<void> {
    const whatsappNumber = normalizeWhatsAppNumber(input.whatsappNumber);
    if (!whatsappNumber) {
      throw new BadRequestException('Nomor WhatsApp tidak valid.');
    }

    const result = await this.prisma.customer.updateMany({
      where: { id: customerId, businessId },
      data: {
        name: input.name.trim(),
        whatsappNumber,
        email: input.email ? normalizeEmail(input.email) : null,
        address: optionalText(input.address),
        notes: optionalText(input.notes),
      },
    });

    if (result.count === 0) {
      throw new NotFoundException('Pelanggan tidak ditemukan pada bisnis ini.');
    }
  }

  async archive(businessId: string, customerId: string): Promise<void> {
    const result = await this.prisma.customer.updateMany({
      where: { id: customerId, businessId },
      data: { archivedAt: new Date() },
    });

    if (result.count === 0) {
      throw new NotFoundException('Pelanggan tidak ditemukan pada bisnis ini.');
    }
  }

  async restore(businessId: string, customerId: string): Promise<void> {
    const result = await this.prisma.customer.updateMany({
      where: { id: customerId, businessId },
      data: { archivedAt: null },
    });

    if (result.count === 0) {
      throw new NotFoundException('Pelanggan tidak ditemukan pada bisnis ini.');
    }
  }

  async countActive(businessId: string): Promise<number> {
    return this.prisma.customer.count({
      where: { businessId, archivedAt: null },
    });
  }
}
