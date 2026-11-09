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
import { parseDateOnly, todayDateOnly } from '../common/helpers/date-only.js';
import { formatRupiah } from '../common/helpers/format.js';
import { readPage, readString } from '../common/helpers/query.js';
import { toRecord } from '../common/helpers/record.js';
import { SessionService } from '../common/session/session.service.js';
import { FormValidationService } from '../common/validation/form-validation.service.js';
import { InvoiceService } from '../invoices/invoice.service.js';
import { PaymentFormDto, VoidPaymentDto } from './dto/payment-form.dto.js';
import {
  PaymentExceedsOutstandingError,
  PaymentNotAllowedError,
  PaymentService,
  type PaymentListFilter,
} from './payment.service.js';

const PER_PAGE = 10;

interface PaymentFormValues {
  amount: string;
  paymentDate: string;
  method: string;
  reference: string;
  notes: string;
}

function amountText(value: unknown, raw: Record<string, unknown>): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? String(value)
    : readString(raw.amount);
}

@Controller()
@UseGuards(TenantAuthGuard)
export class PaymentController {
  constructor(
    private readonly paymentService: PaymentService,
    private readonly invoiceService: InvoiceService,
    private readonly formValidation: FormValidationService,
    private readonly sessionService: SessionService,
    private readonly configService: ConfigService,
  ) {}

  @Get('payments')
  async index(
    @CurrentAuth() auth: AuthenticationContext,
    @Query() query: Record<string, unknown>,
    @Res() response: Response,
  ): Promise<void> {
    const search = readString(query.q);
    const statusText = readString(query.status);
    const status: PaymentListFilter =
      statusText === 'valid' || statusText === 'void' ? statusText : null;
    const page = readPage(query.page);

    const { payments, pagination } = await this.paymentService.list({
      businessId: auth.businessId,
      search,
      status,
      page,
      perPage: PER_PAGE,
    });

    response.render('payments/index', {
      pageTitle: 'Pembayaran',
      pageSubtitle: 'Riwayat pembayaran pelanggan',
      activeNav: 'payments',
      payments,
      pagination,
      filters: { q: search, status: status ?? '' },
    });
  }

  @Get('payments/:id')
  async show(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') paymentId: string,
    @Res() response: Response,
  ): Promise<void> {
    const payment = await this.paymentService.getById(auth.businessId, paymentId);
    const invoice = await this.invoiceService.getById(auth.businessId, payment.invoiceId);
    const summary = this.invoiceService.summarize(invoice);

    response.render('payments/detail', {
      pageTitle: 'Detail Pembayaran',
      pageSubtitle: payment.invoice.invoiceNumber,
      activeNav: 'payments',
      payment,
      invoice,
      summary,
    });
  }

  @Get('invoices/:id/payments/new')
  async showCreateForm(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') invoiceId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const invoice = await this.invoiceService.getById(auth.businessId, invoiceId);
    const summary = this.invoiceService.summarize(invoice);

    if (invoice.cancelledAt || summary.outstanding <= 0) {
      this.sessionService.setFlash(
        request,
        'info',
        invoice.cancelledAt
          ? 'Invoice yang dibatalkan tidak dapat menerima pembayaran.'
          : 'Invoice ini sudah lunas.',
      );
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/invoices/${invoice.id}`);
      return;
    }

    this.renderForm(response, {
      status: HttpStatus.OK,
      invoice,
      summary,
      values: {
        amount: String(summary.outstanding),
        paymentDate: this.today(),
        method: 'CASH',
        reference: '',
        notes: '',
      },
      errors: {},
    });
  }

  @Post('invoices/:id/payments')
  async record(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') invoiceId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const invoice = await this.invoiceService.getById(auth.businessId, invoiceId);
    const summary = this.invoiceService.summarize(invoice);

    if (invoice.cancelledAt || summary.outstanding <= 0) {
      this.sessionService.setFlash(
        request,
        'info',
        invoice.cancelledAt
          ? 'Invoice yang dibatalkan tidak dapat menerima pembayaran.'
          : 'Invoice ini sudah lunas.',
      );
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/invoices/${invoice.id}`);
      return;
    }

    const raw = toRecord(body);
    const result = await this.formValidation.validate(PaymentFormDto, raw);
    const errors: Record<string, string> = { ...result.errors };
    const paymentDate = parseDateOnly(result.data.paymentDate ?? '');

    if (!paymentDate) {
      errors.paymentDate = 'Tanggal pembayaran tidak valid.';
    }

    const values: PaymentFormValues = {
      amount: amountText(result.data.amount, raw),
      paymentDate: result.data.paymentDate ?? '',
      method: result.data.method ?? 'CASH',
      reference: result.data.reference ?? '',
      notes: result.data.notes ?? '',
    };

    if (Object.keys(errors).length > 0) {
      this.renderForm(response, {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        invoice,
        summary,
        values,
        errors,
      });
      return;
    }

    try {
      await this.paymentService.record(auth.businessId, invoice.id, auth.userId, {
        amount: result.data.amount,
        paymentDate: paymentDate as Date,
        method: result.data.method,
        reference: result.data.reference,
        notes: result.data.notes,
      });

      this.sessionService.setFlash(request, 'success', 'Pembayaran berhasil dicatat.');
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/invoices/${invoice.id}`);
    } catch (error) {
      if (error instanceof PaymentExceedsOutstandingError) {
        this.renderForm(response, {
          status: HttpStatus.UNPROCESSABLE_ENTITY,
          invoice,
          summary,
          values,
          errors: {
            amount: `Nominal melebihi sisa tagihan (${formatRupiah(error.outstanding)}).`,
          },
        });
        return;
      }
      if (error instanceof PaymentNotAllowedError) {
        this.sessionService.setFlash(request, 'error', error.message);
        await this.sessionService.save(request);
        response.redirect(HttpStatus.SEE_OTHER, `/invoices/${invoice.id}`);
        return;
      }
      throw error;
    }
  }

  @Post('payments/:id/void')
  async voidPayment(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') paymentId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.formValidation.validate(VoidPaymentDto, toRecord(body));

    if (!result.valid) {
      this.sessionService.setFlash(
        request,
        'error',
        result.errors.reason ?? 'Alasan void wajib diisi.',
      );
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/payments/${paymentId}`);
      return;
    }

    try {
      await this.paymentService.void(auth.businessId, paymentId, auth.userId, result.data.reason);
      this.sessionService.setFlash(
        request,
        'success',
        'Pembayaran berhasil di-void. Sisa tagihan telah dihitung ulang.',
      );
    } catch (error) {
      if (error instanceof PaymentNotAllowedError) {
        this.sessionService.setFlash(request, 'error', error.message);
      } else {
        throw error;
      }
    }

    await this.sessionService.save(request);
    response.redirect(HttpStatus.SEE_OTHER, `/payments/${paymentId}`);
  }

  private renderForm(
    response: Response,
    options: {
      status: number;
      invoice: Awaited<ReturnType<InvoiceService['getById']>>;
      summary: ReturnType<InvoiceService['summarize']>;
      values: PaymentFormValues;
      errors: Record<string, string>;
    },
  ): void {
    response.status(options.status).render('payments/new', {
      pageTitle: 'Catat Pembayaran',
      pageSubtitle: options.invoice.invoiceNumber,
      activeNav: 'invoices',
      invoice: options.invoice,
      summary: options.summary,
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
