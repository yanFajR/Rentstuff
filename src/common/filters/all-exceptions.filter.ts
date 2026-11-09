import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { escapeHtml } from '../helpers/html.js';

interface NormalizedException {
  statusCode: number;
  message: string;
  details?: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function safeMessage(message: string, statusCode: number): string {
  if (statusCode === HttpStatus.NOT_FOUND) {
    return 'Halaman tidak ditemukan.';
  }
  return message;
}

function normalizeException(exception: unknown): NormalizedException {
  if (exception instanceof HttpException) {
    const statusCode = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { statusCode, message: safeMessage(payload, statusCode) };
    }

    if (isRecord(payload)) {
      if (Array.isArray(payload.message)) {
        return {
          statusCode,
          message: 'Permintaan tidak valid.',
          details: payload.message.map((detail) => String(detail)),
        };
      }
      if (typeof payload.message === 'string') {
        return { statusCode, message: safeMessage(payload.message, statusCode) };
      }
      if (typeof payload.error === 'string') {
        return { statusCode, message: safeMessage(payload.error, statusCode) };
      }
    }

    return { statusCode, message: safeMessage(exception.message, statusCode) };
  }

  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    message: 'Terjadi kesalahan pada server.',
  };
}

function hintForStatus(statusCode: number): string {
  switch (statusCode) {
    case HttpStatus.NOT_FOUND:
      return 'Halaman yang Anda cari tidak tersedia atau sudah dipindahkan.';
    case HttpStatus.FORBIDDEN:
      return 'Anda tidak memiliki akses ke halaman ini.';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'Terlalu banyak permintaan. Silakan coba lagi beberapa saat lagi.';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'Layanan sedang tidak tersedia. Silakan coba lagi nanti.';
    default:
      return 'Silakan coba lagi. Jika masalah berlanjut, hubungi administrator.';
  }
}

function wantsHtmlResponse(request: Request): boolean {
  if (request.originalUrl.startsWith('/health') || request.originalUrl.startsWith('/api')) {
    return false;
  }
  const accept = request.headers.accept;
  if (!accept) {
    return true;
  }
  return accept.includes('text/html') || accept.includes('*/*');
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const normalized = normalizeException(exception);
    const isServerError = normalized.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR;
    const path = request.originalUrl.split('?')[0] ?? request.path;

    if (isServerError) {
      this.logger.error(
        `${request.method} ${path} -> ${normalized.statusCode}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    } else {
      this.logger.warn(
        `${request.method} ${path} -> ${normalized.statusCode}: ${normalized.message}`,
      );
    }

    if (response.headersSent) {
      return;
    }

    if (wantsHtmlResponse(request)) {
      this.renderHtml(response, request, normalized);
      return;
    }

    response.status(normalized.statusCode).json({
      statusCode: normalized.statusCode,
      message: normalized.message,
      ...(normalized.details ? { details: normalized.details } : {}),
      path: request.originalUrl.split('?')[0] ?? request.path,
      timestamp: new Date().toISOString(),
    });
  }

  private renderHtml(response: Response, request: Request, normalized: NormalizedException): void {
    if (request.headers['hx-request'] === 'true') {
      response
        .status(normalized.statusCode)
        .type('html')
        .send(
          `<div class="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-medium text-rose-700">${escapeHtml(normalized.message)}</div>`,
        );
      return;
    }

    response.status(normalized.statusCode).render('errors/error', {
      pageTitle: `Kesalahan ${normalized.statusCode}`,
      pageSubtitle: '',
      activeNav: '',
      statusCode: normalized.statusCode,
      message: normalized.message,
      details: normalized.details ?? null,
      hint: hintForStatus(normalized.statusCode),
    });
  }
}
