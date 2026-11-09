import { Injectable, type NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NextFunction, Request, Response } from 'express';
import { dateOnlyInTimezone, todayDateOnly } from '../helpers/date-only.js';
import {
  formatDate,
  formatDateTime,
  formatNumber,
  formatRupiah,
  formatUptime,
} from '../helpers/format.js';
import { buildUrl } from '../helpers/url.js';
import { NAVIGATION } from '../navigation/navigation.js';
import { RENTAL_STATUS_CLASSES, RENTAL_STATUS_LABELS } from '../../rentals/rental-status.js';
import { INVOICE_STATUS_CLASSES, INVOICE_STATUS_LABELS } from '../../invoices/invoice-status.js';
import { PAYMENT_METHOD_LABELS } from '../../payments/payment-method.js';
import { REMINDER_RULES } from '../../reminders/reminder-rules.js';
import {
  REMINDER_ACTIVITY_CLASSES,
  REMINDER_ACTIVITY_LABELS,
  REMINDER_CONTACT_STATUS_CLASSES,
  REMINDER_CONTACT_STATUS_LABELS,
  REMINDER_JOB_STATUS_CLASSES,
  REMINDER_JOB_STATUS_LABELS,
  REMINDER_TIMING_CLASSES,
  REMINDER_TIMING_LABELS,
} from '../../reminders/reminder-status.js';
import { CsrfService } from '../security/csrf.service.js';

const TOKEN_EXEMPT_PREFIXES = ['/assets', '/vendor', '/health', '/favicon.ico'];
const TOKEN_SAFE_METHODS = new Set(['GET', 'HEAD']);

@Injectable()
export class ViewLocalsMiddleware implements NestMiddleware {
  constructor(
    private readonly configService: ConfigService,
    private readonly csrfService: CsrfService,
  ) {}

  use(request: Request, response: Response, next: NextFunction): void {
    const timezone = this.configService.get<string>('app.timezone') ?? 'Asia/Jakarta';
    const session = request.session;
    const exemptFromToken = TOKEN_EXEMPT_PREFIXES.some((prefix) =>
      request.originalUrl.startsWith(prefix),
    );

    response.locals.appName = this.configService.get<string>('app.name') ?? 'Rental Reminder';
    response.setHeader('Cache-Control', 'no-store');
    response.locals.timezone = timezone;
    response.locals.currentYear = new Date().getFullYear();
    response.locals.pageTitle = '';
    response.locals.pageSubtitle = '';
    response.locals.activeNav = '';
    response.locals.currentUser = null;
    response.locals.currentBusiness = null;
    response.locals.flash = null;
    response.locals.csrfToken = '';
    response.locals.navSections = NAVIGATION;
    response.locals.formatRupiah = formatRupiah;
    response.locals.formatNumber = formatNumber;
    response.locals.formatDate = (value: Date | string): string => formatDate(value, timezone);
    response.locals.formatDateTime = (value: Date | string): string =>
      formatDateTime(value, timezone);
    response.locals.formatUptime = formatUptime;
    response.locals.buildUrl = buildUrl;
    response.locals.todayDateOnly = (): string => todayDateOnly(timezone);
    response.locals.dateOnly = (value: Date | string): string =>
      dateOnlyInTimezone(value instanceof Date ? value : new Date(value), timezone);
    response.locals.rentalStatusLabels = RENTAL_STATUS_LABELS;
    response.locals.rentalStatusClasses = RENTAL_STATUS_CLASSES;
    response.locals.invoiceStatusLabels = INVOICE_STATUS_LABELS;
    response.locals.invoiceStatusClasses = INVOICE_STATUS_CLASSES;
    response.locals.paymentMethodLabels = PAYMENT_METHOD_LABELS;
    response.locals.reminderRules = REMINDER_RULES;
    response.locals.reminderTypeLabels = Object.fromEntries(
      REMINDER_RULES.map((rule) => [rule.type, rule.label]),
    );
    response.locals.reminderTypeDescriptions = Object.fromEntries(
      REMINDER_RULES.map((rule) => [rule.type, rule.description]),
    );
    response.locals.reminderJobStatusLabels = REMINDER_JOB_STATUS_LABELS;
    response.locals.reminderJobStatusClasses = REMINDER_JOB_STATUS_CLASSES;
    response.locals.reminderContactStatusLabels = REMINDER_CONTACT_STATUS_LABELS;
    response.locals.reminderContactStatusClasses = REMINDER_CONTACT_STATUS_CLASSES;
    response.locals.reminderTimingLabels = REMINDER_TIMING_LABELS;
    response.locals.reminderTimingClasses = REMINDER_TIMING_CLASSES;
    response.locals.reminderActivityLabels = REMINDER_ACTIVITY_LABELS;
    response.locals.reminderActivityClasses = REMINDER_ACTIVITY_CLASSES;

    if (session) {
      if (session.flash) {
        response.locals.flash = session.flash;
        delete session.flash;
      }

      const canCreateToken =
        !exemptFromToken && TOKEN_SAFE_METHODS.has(request.method.toUpperCase());
      response.locals.csrfToken = canCreateToken
        ? this.csrfService.ensureToken(request)
        : (session.csrfToken ?? '');
    }

    next();
  }
}
