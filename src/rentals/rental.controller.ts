import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

import type { AuthenticationContext } from '../common/auth/authenticated-request.js';
import { CurrentAuth } from '../common/auth/current-auth.decorator.js';
import { TenantAuthGuard } from '../common/auth/tenant-auth.guard.js';
import { aggregateInvoices, summarizeInvoice } from '../common/finance/invoice-calculations.js';
import { dateOnlyInTimezone, parseDateOnly, todayDateOnly } from '../common/helpers/date-only.js';
import { readOneOf, readPage, readString } from '../common/helpers/query.js';
import { toRecord } from '../common/helpers/record.js';
import { SessionService } from '../common/session/session.service.js';
import { FormValidationService } from '../common/validation/form-validation.service.js';
import { CustomerService } from '../customers/customer.service.js';
import { RentalFormDto } from './dto/rental-form.dto.js';
import {
  CustomerNotAvailableError,
  RENTAL_SORTS,
  RentalService,
  type RentalSort,
} from './rental.service.js';
import { isRentalStatus, type RentalStatus } from './rental-status.js';

const PER_PAGE = 10;

interface RentalFormValues {
  customerId: string;
  itemName: string;
  startDate: string;
  endDate: string;
  price: string;
  notes: string;
}

function priceText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function valuesFromDto(data: RentalFormDto, raw: Record<string, unknown>): RentalFormValues {
  const rawPrice = readString(raw.price);
  return {
    customerId: data.customerId ?? '',
    itemName: data.itemName ?? '',
    startDate: data.startDate ?? '',
    endDate: data.endDate ?? '',
    price: priceText(data.price) || rawPrice,
    notes: data.notes ?? '',
  };
}

@Controller('rentals')
@UseGuards(TenantAuthGuard)
export class RentalController {
  constructor(
    private readonly rentalService: RentalService,
    private readonly customerService: CustomerService,
    private readonly formValidation: FormValidationService,
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  async index(
    @CurrentAuth() auth: AuthenticationContext,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const search = readString(query.q);
    const statusText = readString(query.status);
    const status = isRentalStatus(statusText) ? statusText : null;
    const fromText = readString(query.from);
    const toText = readString(query.to);
    const sort = readOneOf<RentalSort>(query.sort, RENTAL_SORTS, 'created_desc');
    const page = readPage(query.page);

    const { rentals, pagination } = await this.rentalService.list({
      businessId: auth.businessId,
      search,
      status,
      from: parseDateOnly(fromText),
      to: parseDateOnly(toText),
      sort,
      page,
      perPage: PER_PAGE,
    });

    response.render('rentals/index', {
      pageTitle: 'Penyewaan',
      pageSubtitle: 'Kelola penyewaan bisnis Anda',
      activeNav: 'rentals',
      rentals,
      pagination,
      filters: {
        q: search,
        status: status ?? '',
        from: fromText,
        to: toText,
        sort,
      },
    });
  }

  @Get('new')
  async showCreateForm(
    @CurrentAuth() auth: AuthenticationContext,
    @Query('customerId') customerIdQuery: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const customers = await this.customerService.getSelectable(auth.businessId);
    const requestedCustomerId = readString(customerIdQuery);
    const selectedCustomerId = customers.some((customer) => customer.id === requestedCustomerId)
      ? requestedCustomerId
      : '';
    const today = todayDateOnly(this.configService.get<string>('app.timezone') ?? 'Asia/Jakarta');

    this.renderForm(response, {
      mode: 'create',
      status: HttpStatus.OK,
      customers,
      values: {
        customerId: selectedCustomerId,
        itemName: '',
        startDate: today,
        endDate: today,
        price: '',
        notes: '',
      },
      errors: {},
    });
  }

  @Post()
  async create(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthenticationContext,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const raw = toRecord(body);
    const result = await this.formValidation.validate(RentalFormDto, raw);
    const errors: Record<string, string> = { ...result.errors };
    const startDate = parseDateOnly(result.data.startDate ?? '');
    const endDate = parseDateOnly(result.data.endDate ?? '');

    if (!startDate) {
      errors.startDate = 'Tanggal mulai tidak valid.';
    }
    if (!endDate) {
      errors.endDate = 'Tanggal selesai tidak valid.';
    }
    if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
      errors.endDate = 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
    }

    const customers = await this.customerService.getSelectable(auth.businessId);

    if (Object.keys(errors).length > 0) {
      this.renderForm(response, {
        mode: 'create',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        customers,
        values: valuesFromDto(result.data, raw),
        errors,
      });
      return;
    }

    try {
      const rental = await this.rentalService.create(auth.businessId, {
        customerId: result.data.customerId,
        itemName: result.data.itemName,
        startDate: startDate as Date,
        endDate: endDate as Date,
        price: result.data.price,
        notes: result.data.notes,
      });

      this.sessionService.setFlash(request, 'success', 'Penyewaan berhasil dibuat.');
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/rentals/${rental.id}`);
    } catch (error) {
      if (error instanceof CustomerNotAvailableError) {
        this.renderForm(response, {
          mode: 'create',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          customers,
          values: valuesFromDto(result.data, raw),
          errors: { customerId: error.message },
        });
        return;
      }
      throw error;
    }
  }

  @Get(':id')
  async show(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') rentalId: string,
    @Res() response: Response,
  ): Promise<void> {
    const rental = await this.rentalService.getById(auth.businessId, rentalId);
    const timezone = this.timezone();
    const today = todayDateOnly(timezone);
    const invoices = rental.invoices.map((invoice) => ({
      ...invoice,
      summary: summarizeInvoice(invoice, today, timezone),
    }));
    const financials = aggregateInvoices(rental.invoices, today, timezone);

    response.render('rentals/detail', {
      pageTitle: 'Detail Transaksi',
      pageSubtitle: rental.rentalNumber,
      activeNav: 'rentals',
      rental,
      invoices,
      financials,
    });
  }

  @Get(':id/edit')
  async showEditForm(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') rentalId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const rental = await this.rentalService.getById(auth.businessId, rentalId);

    if (rental.status !== 'ACTIVE') {
      this.sessionService.setFlash(
        request,
        'info',
        'Transaksi yang sudah selesai atau dibatalkan tidak dapat diubah.',
      );
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/rentals/${rental.id}`);
      return;
    }

    const customers = await this.customerService.getSelectable(auth.businessId);
    const timezone = this.configService.get<string>('app.timezone') ?? 'Asia/Jakarta';

    this.renderForm(response, {
      mode: 'edit',
      status: HttpStatus.OK,
      rentalId: rental.id,
      customers,
      invoiceCount: rental.invoices.length,
      values: {
        customerId: rental.customerId,
        itemName: rental.itemName,
        startDate: dateOnlyInTimezone(rental.startDate, timezone),
        endDate: dateOnlyInTimezone(rental.endDate, timezone),
        price: String(rental.price),
        notes: rental.notes ?? '',
      },
      errors: {},
    });
  }

  @Post(':id')
  async update(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') rentalId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const rental = await this.rentalService.getById(auth.businessId, rentalId);

    if (rental.status !== 'ACTIVE') {
      this.sessionService.setFlash(
        request,
        'info',
        'Transaksi yang sudah selesai atau dibatalkan tidak dapat diubah.',
      );
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/rentals/${rental.id}`);
      return;
    }

    const raw = toRecord(body);
    const result = await this.formValidation.validate(RentalFormDto, raw);
    const errors: Record<string, string> = { ...result.errors };
    const startDate = parseDateOnly(result.data.startDate ?? '');
    const endDate = parseDateOnly(result.data.endDate ?? '');

    if (!startDate) {
      errors.startDate = 'Tanggal mulai tidak valid.';
    }
    if (!endDate) {
      errors.endDate = 'Tanggal selesai tidak valid.';
    }
    if (startDate && endDate && endDate.getTime() < startDate.getTime()) {
      errors.endDate = 'Tanggal selesai tidak boleh sebelum tanggal mulai.';
    }

    const customers = await this.customerService.getSelectable(auth.businessId);

    if (Object.keys(errors).length > 0) {
      this.renderForm(response, {
        mode: 'edit',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        rentalId: rental.id,
        customers,
        invoiceCount: rental.invoices.length,
        values: valuesFromDto(result.data, raw),
        errors,
      });
      return;
    }

    try {
      await this.rentalService.update(auth.businessId, rental.id, {
        customerId: result.data.customerId,
        itemName: result.data.itemName,
        startDate: startDate as Date,
        endDate: endDate as Date,
        price: result.data.price,
        notes: result.data.notes,
      });

      this.sessionService.setFlash(request, 'success', 'Perubahan penyewaan berhasil disimpan.');
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/rentals/${rental.id}`);
    } catch (error) {
      if (error instanceof CustomerNotAvailableError) {
        this.renderForm(response, {
          mode: 'edit',
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          rentalId: rental.id,
          customers,
          values: valuesFromDto(result.data, raw),
          errors: { customerId: error.message },
        });
        return;
      }
      if (error instanceof BadRequestException) {
        this.sessionService.setFlash(request, 'error', error.message);
        await this.sessionService.save(request);
        response.redirect(HttpStatus.SEE_OTHER, `/rentals/${rental.id}`);
        return;
      }
      throw error;
    }
  }

  @Post(':id/complete')
  async complete(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') rentalId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.applyStatusChange(
      auth,
      rentalId,
      'COMPLETED',
      'Transaksi ditandai selesai.',
      request,
      response,
    );
  }

  @Post(':id/cancel')
  async cancel(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') rentalId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.applyStatusChange(
      auth,
      rentalId,
      'CANCELLED',
      'Transaksi berhasil dibatalkan.',
      request,
      response,
    );
  }

  private async applyStatusChange(
    auth: AuthenticationContext,
    rentalId: string,
    status: RentalStatus,
    successMessage: string,
    request: Request,
    response: Response,
  ): Promise<void> {
    try {
      await this.rentalService.changeStatus(auth.businessId, rentalId, status);
      this.sessionService.setFlash(request, 'success', successMessage);
    } catch (error) {
      if (error instanceof BadRequestException) {
        this.sessionService.setFlash(request, 'error', error.message);
      } else {
        throw error;
      }
    }

    await this.sessionService.save(request);
    response.redirect(HttpStatus.SEE_OTHER, `/rentals/${rentalId}`);
  }

  private renderForm(
    response: Response,
    options: {
      mode: 'create' | 'edit';
      status: number;
      rentalId?: string;
      customers: Array<{ id: string; name: string; whatsappNumber: string }>;
      values: RentalFormValues;
      errors: Record<string, string>;
      invoiceCount?: number;
    },
  ): void {
    response
      .status(options.status)
      .render(options.mode === 'edit' ? 'rentals/edit' : 'rentals/new', {
        pageTitle: options.mode === 'edit' ? 'Edit Penyewaan' : 'Tambah Penyewaan',
        pageSubtitle:
          options.mode === 'edit' ? 'Perbarui informasi penyewaan' : 'Buat penyewaan baru',
        activeNav: 'rentals',
        mode: options.mode,
        rentalId: options.rentalId ?? '',
        invoiceCount: options.invoiceCount ?? 0,
        customers: options.customers,
        values: options.values,
        errors: options.errors,
      });
  }

  private timezone(): string {
    return this.configService.get<string>('app.timezone') ?? 'Asia/Jakarta';
  }
}
