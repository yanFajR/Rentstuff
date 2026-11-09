import {
  Body,
  Controller,
  Get,
  HttpStatus,
  NotFoundException,
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
import { parseDateOnly } from '../common/helpers/date-only.js';
import { readOneOf, readPage, readString } from '../common/helpers/query.js';
import { toRecord } from '../common/helpers/record.js';
import { normalizeWhatsAppNumber } from '../common/helpers/whatsapp.js';
import { SessionService } from '../common/session/session.service.js';
import { FormValidationService } from '../common/validation/form-validation.service.js';
import { buildReminderMessage } from './reminder-message.js';
import { isReminderJobStatus, isReminderType, REMINDER_TIMEZONE } from './reminder-rules.js';
import { ReminderSchedulerService } from './reminder-scheduler.service.js';
import {
  REMINDER_SORTS,
  ReminderActionError,
  ReminderService,
  type ReminderSort,
} from './reminder.service.js';
import { MarkReminderSentDto } from './dto/reminder-action.dto.js';

const PER_PAGE = 10;

@Controller('reminders')
@UseGuards(TenantAuthGuard)
export class ReminderController {
  constructor(
    private readonly reminderService: ReminderService,
    private readonly schedulerService: ReminderSchedulerService,
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
    const typeText = readString(query.type);
    const type = isReminderType(typeText) ? typeText : null;
    const statusText = readString(query.status);
    const status = isReminderJobStatus(statusText) ? statusText : null;
    const fromText = readString(query.from);
    const toText = readString(query.to);
    const sort = readOneOf<ReminderSort>(query.sort, REMINDER_SORTS, 'scheduled_desc');
    const page = readPage(query.page);

    const [{ reminders, pagination }, summary] = await Promise.all([
      this.reminderService.list({
        businessId: auth.businessId,
        search,
        type,
        status,
        from: parseDateOnly(fromText),
        to: parseDateOnly(toText),
        sort,
        page,
        perPage: PER_PAGE,
      }),
      this.reminderService.getSummary(auth.businessId),
    ]);

    response.render('reminders/index', {
      pageTitle: 'Pengingat',
      pageSubtitle: 'Pantau dan tindak lanjuti pengingat pembayaran pelanggan',
      activeNav: 'reminders',
      reminders,
      pagination,
      summary,
      filters: {
        q: search,
        type: type ?? '',
        status: status ?? '',
        from: fromText,
        to: toText,
        sort,
      },
    });
  }

  @Get(':id')
  async show(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') reminderId: string,
    @Res() response: Response,
  ): Promise<void> {
    const reminder = await this.reminderService.getById(auth.businessId, reminderId);
    const summary = this.reminderService.summarize(reminder);
    const contactStatus = this.reminderService.contactStatus(reminder);
    const hasValidNumber = Boolean(
      normalizeWhatsAppNumber(reminder.invoice.rentalRecord.customer.whatsappNumber),
    );
    const isActive =
      reminder.status === 'READY' && !reminder.invoice.cancelledAt && summary.outstanding > 0;
    const canOpen = isActive && hasValidNumber;
    const canMarkSent = isActive && contactStatus !== 'SENT';

    const messagePreview = canOpen
      ? buildReminderMessage({
          customerName: reminder.invoice.rentalRecord.customer.name,
          invoiceNumber: reminder.invoice.invoiceNumber,
          businessName: reminder.invoice.business.name,
          outstanding: summary.outstanding,
          dueDate: reminder.invoice.dueDate,
          timezone: REMINDER_TIMEZONE,
        })
      : null;

    response.render('reminders/detail', {
      pageTitle: 'Detail Pengingat',
      pageSubtitle: reminder.invoice.invoiceNumber,
      activeNav: 'reminders',
      reminder,
      summary,
      contactStatus,
      canOpen,
      canMarkSent,
      hasValidNumber,
      messagePreview,
    });
  }

  @Post(':id/whatsapp')
  async openWhatsApp(
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') reminderId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const url = await this.reminderService.openWhatsApp(auth.businessId, reminderId, auth.userId);
      response.redirect(HttpStatus.SEE_OTHER, url);
    } catch (error) {
      if (error instanceof ReminderActionError) {
        this.sessionService.setFlash(request, 'error', error.message);
        await this.sessionService.save(request);
        response.redirect(HttpStatus.SEE_OTHER, `/reminders/${reminderId}`);
        return;
      }
      throw error;
    }
  }

  @Post(':id/marked-sent')
  async markSent(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthenticationContext,
    @Param('id') reminderId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.formValidation.validate(MarkReminderSentDto, toRecord(body));

    if (!result.valid) {
      this.sessionService.setFlash(
        request,
        'error',
        result.errors.notes ?? 'Catatan tindak lanjut tidak valid.',
      );
      await this.sessionService.save(request);
      response.redirect(HttpStatus.SEE_OTHER, `/reminders/${reminderId}`);
      return;
    }

    try {
      await this.reminderService.markSent(
        auth.businessId,
        reminderId,
        auth.userId,
        result.data.notes ?? null,
      );
      this.sessionService.setFlash(
        request,
        'success',
        'Pengingat ditandai sudah dikirim. Aktivitas ini tercatat di riwayat.',
      );
    } catch (error) {
      if (error instanceof ReminderActionError) {
        this.sessionService.setFlash(request, 'error', error.message);
      } else {
        throw error;
      }
    }

    await this.sessionService.save(request);
    response.redirect(HttpStatus.SEE_OTHER, `/reminders/${reminderId}`);
  }

  @Post('run')
  async runScheduler(
    @CurrentAuth() auth: AuthenticationContext,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    if (this.environment() === 'production') {
      throw new NotFoundException();
    }

    const result = await this.schedulerService.runOnce({ businessId: auth.businessId });
    const errorText = result.errors > 0 ? `, ${result.errors} error` : '';
    const message = result.alreadyRunning
      ? 'Scheduler sedang berjalan. Coba lagi setelah proses sebelumnya selesai.'
      : `Scheduler dijalankan: ${result.created} pengingat dibuat, ${result.promoted} menjadi siap, ` +
        `${result.skipped} dilewati, ${result.reactivated} diaktifkan kembali${errorText}.`;

    this.sessionService.setFlash(
      request,
      result.alreadyRunning || result.errors > 0 ? 'info' : 'success',
      message,
    );
    await this.sessionService.save(request);
    response.redirect(HttpStatus.SEE_OTHER, '/reminders');
  }

  private environment(): string {
    return this.configService.get<string>('app.environment') ?? 'development';
  }
}
