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
import {
  addDaysToDateOnly,
  dateOnlyInTimezone,
  parseDateOnly,
  todayDateOnly,
} from '../common/helpers/date-only.js';
import { readOneOf, readPage, readString } from '../common/helpers/query.js';
import { toRecord } from '../common/helpers/record.js';
import { SessionService } from '../common/session/session.service.js';
import { FormValidationService } from '../common/validation/form-validation.service.js';
import { CancelInvoiceDto, CreateInvoiceDto, UpdateInvoiceDto } from './dto/invoice-form.dto.js';
import { isInvoiceStatus } from './invoice-status.js';
import {
  INVOICE_SORTS,
  InvoiceLockedError,
  InvoiceService,
  RentalNotInvoiceableError,
  type InvoiceDetail,
  type InvoiceRentalOption,
  type InvoiceSort,
} from './invoice.service.js';

const PER_PAGE = 10;

interface InvoiceFormValues {
  rentalRecordId: string;
  issueDate: string;
  dueDate: string;
  totalAmount: string;
  description: string;
  notes: string;
}

function priceText(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

@Controller('invoices')
@UseGuards(TenantAuthGuard)
export class InvoiceController {
  constructor(
    private readonly invoiceService: InvoiceService,
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
    const status = isInvoiceStatus(statusText) ? statusText : null;
    const fromText = readString(query.from);
    const toText = readString(query.to);
    const sort = readOneOf<InvoiceSort>(query.sort, INVOICE_SORTS, 'created_desc');
    const page = readPage(query.page);

    const { invoices, pagination } = await this.invoiceService.list({
      businessId: auth.businessId,
      search,
      status,
      from: parseDateOnly(fromText),
      to: parseDateOnly(toText),
      sort,
      page,
      perPage: PER_PAGE,
    });

    response.render('invoices/index', {
      pageTitle: 'Tagihan',
      pageSubtitle: 'Kelola tagihan dan status pembayaran pelanggan',
      activeNav: 'invoices',
      invoices,
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
    @Query('rentalId') rentalIdQuery: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const rentals = await this.invoiceService.getRentalOptions(auth.businessId);
    const requestedRentalId = readString(rentalIdQuery);
    const selectedRental = rentals.find((rental) => rental.id === requestedRentalId) ?? null;
    const today = this.today();
    const dueDate = addDaysToDateOnly(today, 7);

    this.renderCreateForm(response, {
      status: HttpStatus.OK,
      rentals,
      selectedRental,
      values: {
        rentalRecordId: selectedRental?.id ?? '',
        issueDate: today,
        dueDate,
        totalAmount: selectedRental ? String(selectedRental.price) : '',
        description: '',
        notes: '',
      },
      errors: {},
    });
  }

  @Get('rental-summary')
  async showRentalSummary(
    @CurrentAuth() auth: AuthenticationContext,
    @Query('rentalRecordId') rentalIdQuery: unknown,
    @Res() response: Response,
  ): Promise<void> {
    const rentalId = readString(rentalIdQuery);
    const rental = rentalId
      ? await this.invoiceService.getRentalDefault(auth.businessId, rentalId)
      : null;

    response.status(HttpStatus.OK).render('invoices/partials/rental-summary', {
      rental,
      oob: Boolean(rental),
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
    const result = await this.formValidation.validate(CreateInvoiceDto, raw);
    const errors: Record<string, string> = { ...result.errors };
    const issueDate = parseDateOnly(result.data.issueDate ?? '');
    const dueDate = parseDateOnly(result.data.dueDate ?? '');

    if (!issueDate) {
      errors.issueDate = 'Tanggal penerbitan tidak valid.';
    }
    if (!dueDate) {
      errors.dueDate = 'Tanggal jatuh tempo tidak valid.';
    }
    if (issueDate && dueDate && dueDate.getTime() < issueDate.getTime()) {
      errors.dueDate = 'Tanggal jatuh tempo tidak boleh sebelum tanggal penerbitan.';
    }

    const rentals = await this.invoiceService.getRentalOptions(auth.businessId);
    const selectedRental =
      rentals.find((rental) => rental.id === result.data.rentalRecordId) ?? null;

    if (Object.keys(errors).length > 0) {
      this.renderCreateForm(response, {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        rentals,
        selectedRental,
        values: this.valuesFromCreate(result.data, raw),
        errors,
      });
      return;
    }

    try {
      const invoice = await this.invoiceService.create(auth.businessId, {
        rentalRecordId: result.data.rentalRecordId,
        issueDate: issueDate as Date,
        dueDate: dueDate as Date,
        totalAmount: result.data.totalAmount,
        description: result.data.description,
        notes: result.data.notes,
      });

      this.sessionService.setFlash(request, 'success', 'Tagihan berhasil dibuat.');
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/invoices/${invoice.id}`);
    } catch (error) {
      if (error instanceof RentalNotInvoiceableError) {
        this.renderCreateForm(response, {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          rentals,
          selectedRental,
          values: this.valuesFromCreate(result.data, raw),
          errors: { rentalRecordId: error.message },
        });
        return;
      }
      throw error;
    }
  }

  @Get(':id')
  async show(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') invoiceId: string,
    @Res() response: Response,
  ): Promise<void> {
    const invoice = await this.invoiceService.getById(auth.businessId, invoiceId);
    const summary = this.invoiceService.summarize(invoice);
    const validPayments = invoice.payments.filter((payment) => payment.voidedAt === null);
    const canPay = !invoice.cancelledAt && summary.outstanding > 0;
    const canEdit =
      !invoice.cancelledAt && summary.status !== 'PAID' && invoice.payments.length === 0;
    const canCancel = !invoice.cancelledAt && validPayments.length === 0;

    response.render('invoices/detail', {
      pageTitle: 'Detail Tagihan',
      pageSubtitle: invoice.invoiceNumber,
      activeNav: 'invoices',
      invoice,
      summary,
      canPay,
      canEdit,
      canCancel,
    });
  }

  @Get(':id/edit')
  async showEditForm(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') invoiceId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const invoice = await this.invoiceService.getById(auth.businessId, invoiceId);
    const summary = this.invoiceService.summarize(invoice);

    if (invoice.cancelledAt || summary.status === 'PAID' || invoice.payments.length > 0) {
      this.sessionService.setFlash(
        request,
        'info',
        'Invoice ini tidak dapat diedit karena sudah lunas, dibatalkan, atau memiliki pembayaran.',
      );
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/invoices/${invoice.id}`);
      return;
    }

    this.renderEditForm(response, {
      status: HttpStatus.OK,
      invoice,
      values: this.valuesFromInvoice(invoice),
      errors: {},
    });
  }

  @Post(':id')
  async update(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') invoiceId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const invoice = await this.invoiceService.getById(auth.businessId, invoiceId);
    const summary = this.invoiceService.summarize(invoice);

    if (invoice.cancelledAt || summary.status === 'PAID' || invoice.payments.length > 0) {
      this.sessionService.setFlash(
        request,
        'info',
        'Invoice ini tidak dapat diedit karena sudah lunas, dibatalkan, atau memiliki pembayaran.',
      );
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/invoices/${invoice.id}`);
      return;
    }

    const raw = toRecord(body);
    const result = await this.formValidation.validate(UpdateInvoiceDto, raw);
    const errors: Record<string, string> = { ...result.errors };
    const issueDate = parseDateOnly(result.data.issueDate ?? '');
    const dueDate = parseDateOnly(result.data.dueDate ?? '');

    if (!issueDate) {
      errors.issueDate = 'Tanggal penerbitan tidak valid.';
    }
    if (!dueDate) {
      errors.dueDate = 'Tanggal jatuh tempo tidak valid.';
    }
    if (issueDate && dueDate && dueDate.getTime() < issueDate.getTime()) {
      errors.dueDate = 'Tanggal jatuh tempo tidak boleh sebelum tanggal penerbitan.';
    }

    if (Object.keys(errors).length > 0) {
      this.renderEditForm(response, {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        invoice,
        values: this.valuesFromUpdate(result.data, raw),
        errors,
      });
      return;
    }

    try {
      await this.invoiceService.update(auth.businessId, invoice.id, {
        issueDate: issueDate as Date,
        dueDate: dueDate as Date,
        totalAmount: result.data.totalAmount,
        description: result.data.description,
        notes: result.data.notes,
      });

      this.sessionService.setFlash(request, 'success', 'Perubahan tagihan berhasil disimpan.');
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/invoices/${invoice.id}`);
    } catch (error) {
      if (error instanceof InvoiceLockedError) {
        this.sessionService.setFlash(request, 'error', error.message);
        await this.sessionService.save(request);
        response.redirect(HttpStatus.SEE_OTHER, `/invoices/${invoice.id}`);
        return;
      }
      throw error;
    }
  }

  @Post(':id/cancel')
  async cancel(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') invoiceId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.formValidation.validate(CancelInvoiceDto, toRecord(body));

    if (!result.valid) {
      this.sessionService.setFlash(
        request,
        'error',
        result.errors.reason ?? 'Alasan pembatalan wajib diisi.',
      );
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/invoices/${invoiceId}`);
      return;
    }

    try {
      await this.invoiceService.cancel(auth.businessId, invoiceId, result.data.reason);
      this.sessionService.setFlash(request, 'success', 'Tagihan berhasil dibatalkan.');
    } catch (error) {
      if (error instanceof InvoiceLockedError) {
        this.sessionService.setFlash(request, 'error', error.message);
      } else {
        throw error;
      }
    }

    await this.sessionService.save(request);
    response.redirect(HttpStatus.SEE_OTHER, `/invoices/${invoiceId}`);
  }

  private valuesFromCreate(
    data: CreateInvoiceDto,
    raw: Record<string, unknown>,
  ): InvoiceFormValues {
    return {
      rentalRecordId: data.rentalRecordId ?? '',
      issueDate: data.issueDate ?? '',
      dueDate: data.dueDate ?? '',
      totalAmount: priceText(data.totalAmount) || readString(raw.totalAmount),
      description: data.description ?? '',
      notes: data.notes ?? '',
    };
  }

  private valuesFromUpdate(
    data: UpdateInvoiceDto,
    raw: Record<string, unknown>,
  ): InvoiceFormValues {
    return {
      rentalRecordId: '',
      issueDate: data.issueDate ?? '',
      dueDate: data.dueDate ?? '',
      totalAmount: priceText(data.totalAmount) || readString(raw.totalAmount),
      description: data.description ?? '',
      notes: data.notes ?? '',
    };
  }

  private valuesFromInvoice(invoice: InvoiceDetail): InvoiceFormValues {
    const timezone = this.timezone();
    return {
      rentalRecordId: invoice.rentalRecordId,
      issueDate: dateOnlyInTimezone(invoice.issueDate, timezone),
      dueDate: dateOnlyInTimezone(invoice.dueDate, timezone),
      totalAmount: String(invoice.totalAmount),
      description: invoice.description ?? '',
      notes: invoice.notes ?? '',
    };
  }

  private renderCreateForm(
    response: Response,
    options: {
      status: number;
      rentals: InvoiceRentalOption[];
      selectedRental: InvoiceRentalOption | null;
      values: InvoiceFormValues;
      errors: Record<string, string>;
    },
  ): void {
    response.status(options.status).render('invoices/new', {
      pageTitle: 'Buat Tagihan',
      pageSubtitle: 'Buat tagihan dari penyewaan',
      activeNav: 'invoices',
      mode: 'create',
      rentals: options.rentals,
      selectedRental: options.selectedRental,
      values: options.values,
      errors: options.errors,
    });
  }

  private renderEditForm(
    response: Response,
    options: {
      status: number;
      invoice: InvoiceDetail;
      values: InvoiceFormValues;
      errors: Record<string, string>;
    },
  ): void {
    response.status(options.status).render('invoices/edit', {
      pageTitle: 'Edit Tagihan',
      pageSubtitle: options.invoice.invoiceNumber,
      activeNav: 'invoices',
      mode: 'edit',
      invoice: options.invoice,
      values: options.values,
      errors: options.errors,
    });
  }

  private timezone(): string {
    return this.configService.get<string>('app.timezone') ?? 'Asia/Jakarta';
  }

  private today(): string {
    return todayDateOnly(this.timezone());
  }
}
