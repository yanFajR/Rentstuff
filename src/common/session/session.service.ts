import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';

export type FlashMessageType = 'success' | 'error' | 'info';

@Injectable()
export class SessionService {
  constructor(private readonly configService: ConfigService) {}

  get cookieName(): string {
    return this.configService.get<string>('session.name') ?? 'rental_reminder.sid';
  }

  async establish(request: Request, userId: string, businessId: string): Promise<void> {
    await this.regenerate(request);
    request.session.userId = userId;
    request.session.businessId = businessId;
    delete request.session.flash;
    await this.save(request);
  }

  async terminate(request: Request, response: Response): Promise<void> {
    await this.destroy(request);
    response.clearCookie(this.cookieName, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: this.configService.get<boolean>('session.cookieSecure') ?? false,
    });
  }

  setFlash(request: Request, type: FlashMessageType, message: string): void {
    request.session.flash = { type, message };
  }

  regenerate(request: Request): Promise<void> {
    return new Promise((resolve, reject) => {
      request.session.regenerate((error) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolve();
      });
    });
  }

  save(request: Request): Promise<void> {
    return new Promise((resolve, reject) => {
      request.session.save((error) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolve();
      });
    });
  }

  destroy(request: Request): Promise<void> {
    return new Promise((resolve, reject) => {
      request.session.destroy((error) => {
        if (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolve();
      });
    });
  }

  isAuthenticated(request: Request): boolean {
    return Boolean(request.session.userId && request.session.businessId);
  }
}
