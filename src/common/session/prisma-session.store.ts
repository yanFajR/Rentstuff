import expressSession from 'express-session';
import type { PrismaService } from '../prisma/prisma.service.js';

interface SessionRecord {
  data: string;
  expiresAt: Date;
}

export class PrismaSessionStore extends expressSession.Store {
  constructor(
    private readonly prisma: PrismaService,
    private readonly defaultTtlMs: number,
  ) {
    super();
  }

  override get(
    sid: string,
    callback: (error: Error | null, sessionData?: expressSession.SessionData | null) => void,
  ): void {
    void this.find(sid)
      .then((sessionData) => callback(null, sessionData))
      .catch((error: unknown) => callback(this.toError(error)));
  }

  override set(
    sid: string,
    sessionData: expressSession.SessionData,
    callback?: (error?: Error | null) => void,
  ): void {
    void this.persist(sid, sessionData)
      .then(() => callback?.(null))
      .catch((error: unknown) => callback?.(this.toError(error)));
  }

  override destroy(sid: string, callback?: (error?: Error | null) => void): void {
    void this.prisma.session
      .deleteMany({ where: { id: sid } })
      .then(() => callback?.(null))
      .catch((error: unknown) => callback?.(this.toError(error)));
  }

  override touch(
    sid: string,
    sessionData: expressSession.SessionData,
    callback?: (error?: Error | null) => void,
  ): void {
    const expiresAt = this.resolveExpiry(sessionData);
    void this.prisma.session
      .updateMany({ where: { id: sid }, data: { expiresAt } })
      .then(() => callback?.(null))
      .catch((error: unknown) => callback?.(this.toError(error)));
  }

  override clear(callback?: (error?: Error | null) => void): void {
    void this.prisma.session
      .deleteMany({})
      .then(() => callback?.(null))
      .catch((error: unknown) => callback?.(this.toError(error)));
  }

  override length(callback: (error: Error | null, length?: number) => void): void {
    void this.prisma.session
      .count({ where: { expiresAt: { gt: new Date() } } })
      .then((length) => callback(null, length))
      .catch((error: unknown) => callback(this.toError(error)));
  }

  private async find(sid: string): Promise<expressSession.SessionData | null> {
    const record: SessionRecord | null = await this.prisma.session.findUnique({
      where: { id: sid },
      select: { data: true, expiresAt: true },
    });

    if (!record) {
      return null;
    }

    if (record.expiresAt.getTime() <= Date.now()) {
      await this.prisma.session.deleteMany({ where: { id: sid } });
      return null;
    }

    try {
      return JSON.parse(record.data) as expressSession.SessionData;
    } catch {
      await this.prisma.session.deleteMany({ where: { id: sid } });
      return null;
    }
  }

  private async persist(sid: string, sessionData: expressSession.SessionData): Promise<void> {
    const expiresAt = this.resolveExpiry(sessionData);
    const data = JSON.stringify(sessionData);

    await this.prisma.session.upsert({
      where: { id: sid },
      create: { id: sid, data, expiresAt },
      update: { data, expiresAt },
    });
  }

  private resolveExpiry(sessionData: expressSession.SessionData): Date {
    const cookieExpiry = sessionData.cookie?.expires;
    if (cookieExpiry) {
      const expiry = new Date(cookieExpiry);
      if (!Number.isNaN(expiry.getTime())) {
        return expiry;
      }
    }
    return new Date(Date.now() + this.defaultTtlMs);
  }

  private toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
  }
}
