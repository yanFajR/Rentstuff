import {
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
import { todayDateOnly } from '../common/helpers/date-only.js';
import { readOneOf, readPage, readString } from '../common/helpers/query.js';
import { toRecord } from '../common/helpers/record.js';
import { SessionService } from '../common/session/session.service.js';
import { FormValidationService } from '../common/validation/form-validation.service.js';
import { CUSTOMER_SORTS, CustomerService, type CustomerSort } from './customer.service.js';
import { CustomerFormDto } from './dto/customer-form.dto.js';

const PER_PAGE = 10;

interface CustomerFormValues {
  name: string;
  whatsappNumber: string;
  email: string;
  address: string;
  notes: string;
}

const EMPTY_VALUES: CustomerFormValues = {
  name: '',
  whatsappNumber: '',
  email: '',
  address: '',
  notes: '',
};

function valuesFromDto(data: CustomerFormDto): CustomerFormValues {
  return {
    name: data.name ?? '',
    whatsappNumber: data.whatsappNumber ?? '',
    email: data.email ?? '',
    address: data.address ?? '',
    notes: data.notes ?? '',
  };
}

@Controller('customers')
@UseGuards(TenantAuthGuard)
export class CustomerController {
  constructor(
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
    const sort = readOneOf<CustomerSort>(query.sort, CUSTOMER_SORTS, 'created_desc');
    const page = readPage(query.page);

    const { customers, pagination } = await this.customerService.list({
      businessId: auth.businessId,
      search,
      sort,
      page,
      perPage: PER_PAGE,
    });

    response.render('customers/index', {
      pageTitle: 'Pelanggan',
      pageSubtitle: 'Kelola data pelanggan dan riwayat penyewaan mereka',
      activeNav: 'customers',
      customers,
      pagination,
      filters: { q: search, sort },
    });
  }

  @Get('new')
  showCreateForm(@Res() response: Response): void {
    this.renderForm(response, {
      mode: 'create',
      status: HttpStatus.OK,
      values: EMPTY_VALUES,
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
    const result = await this.formValidation.validate(CustomerFormDto, toRecord(body));

    if (!result.valid) {
      this.renderForm(response, {
        mode: 'create',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        values: valuesFromDto(result.data),
        errors: result.errors,
      });
      return;
    }

    const customer = await this.customerService.create(auth.businessId, result.data);

    this.sessionService.setFlash(request, 'success', 'Pelanggan berhasil ditambahkan.');
    await this.sessionService.save(request);

    response.redirect(HttpStatus.SEE_OTHER, `/customers/${customer.id}`);
  }

  @Get('quick-add')
  showQuickAdd(@Res() response: Response): void {
    response.render('customers/quick-add', {
      pageTitle: 'Tambah Pelanggan',
      values: EMPTY_VALUES,
      errors: {},
    });
  }

  @Post('quick-add')
  async quickAdd(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthenticationContext,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.formValidation.validate(CustomerFormDto, toRecord(body));

    if (!result.valid) {
      response.status(HttpStatus.OK).render('customers/quick-add', {
        pageTitle: 'Tambah Pelanggan',
        values: valuesFromDto(result.data),
        errors: result.errors,
      });
      return;
    }

    const created = await this.customerService.create(auth.businessId, result.data);
    const customers = await this.customerService.getSelectable(auth.businessId);

    response.status(HttpStatus.OK).render('customers/quick-add-success', {
      selectedId: created.id,
      customers,
    });
  }

  @Get(':id')
  async show(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') customerId: string,
    @Res() response: Response,
  ): Promise<void> {
    const customer = await this.customerService.getById(auth.businessId, customerId);
    const timezone = this.configService.get<string>('app.timezone') ?? 'Asia/Jakarta';
    const today = todayDateOnly(timezone);
    const invoiceRows = await this.customerService.getInvoicesForCustomer(
      auth.businessId,
      customer.id,
    );
    const invoices = invoiceRows.map((invoice) => ({
      ...invoice,
      summary: summarizeInvoice(invoice, today, timezone),
    }));
    const financials = aggregateInvoices(invoiceRows, today, timezone);

    response.render('customers/detail', {
      pageTitle: 'Detail Pelanggan',
      pageSubtitle: customer.name,
      activeNav: 'customers',
      customer,
      invoices,
      financials,
    });
  }

  @Get(':id/edit')
  async showEditForm(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') customerId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const customer = await this.customerService.getById(auth.businessId, customerId);

    if (customer.archivedAt) {
      this.sessionService.setFlash(
        request,
        'info',
        'Pelanggan yang diarsipkan harus dipulihkan sebelum diedit.',
      );
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/customers/${customer.id}`);
      return;
    }

    this.renderForm(response, {
      mode: 'edit',
      status: HttpStatus.OK,
      customerId: customer.id,
      values: {
        name: customer.name,
        whatsappNumber: customer.whatsappNumber,
        email: customer.email ?? '',
        address: customer.address ?? '',
        notes: customer.notes ?? '',
      },
      errors: {},
    });
  }

  @Post(':id')
  async update(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') customerId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const customer = await this.customerService.getById(auth.businessId, customerId);

    if (customer.archivedAt) {
      this.sessionService.setFlash(
        request,
        'info',
        'Pelanggan yang diarsipkan harus dipulihkan sebelum diedit.',
      );
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/customers/${customer.id}`);
      return;
    }

    const result = await this.formValidation.validate(CustomerFormDto, toRecord(body));

    if (!result.valid) {
      this.renderForm(response, {
        mode: 'edit',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        customerId: customer.id,
        values: valuesFromDto(result.data),
        errors: result.errors,
      });
      return;
    }

    await this.customerService.update(auth.businessId, customer.id, result.data);

    this.sessionService.setFlash(request, 'success', 'Perubahan pelanggan berhasil disimpan.');
    await this.sessionService.save(request);
    response.redirect(HttpStatus.SEE_OTHER, `/customers/${customer.id}`);
  }

  @Post(':id/archive')
  async archive(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') customerId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.customerService.archive(auth.businessId, customerId);

    this.sessionService.setFlash(
      request,
      'success',
      'Pelanggan diarsipkan. Riwayat penyewaan tetap tersimpan.',
    );
    await this.sessionService.save(request);
    response.redirect(HttpStatus.SEE_OTHER, `/customers/${customerId}`);
  }

  @Post(':id/restore')
  async restore(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') customerId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    await this.customerService.restore(auth.businessId, customerId);

    this.sessionService.setFlash(request, 'success', 'Pelanggan berhasil dipulihkan.');
    await this.sessionService.save(request);
    response.redirect(HttpStatus.SEE_OTHER, `/customers/${customerId}`);
  }

  private renderForm(
    response: Response,
    options: {
      mode: 'create' | 'edit';
      status: number;
      customerId?: string;
      values: CustomerFormValues;
      errors: Record<string, string>;
    },
  ): void {
    response
      .status(options.status)
      .render(options.mode === 'edit' ? 'customers/edit' : 'customers/new', {
        pageTitle: options.mode === 'edit' ? 'Edit Pelanggan' : 'Tambah Pelanggan',
        pageSubtitle:
          options.mode === 'edit' ? 'Perbarui informasi pelanggan' : 'Lengkapi data pelanggan baru',
        activeNav: 'customers',
        mode: options.mode,
        customerId: options.customerId ?? '',
        values: options.values,
        errors: options.errors,
      });
  }
}
