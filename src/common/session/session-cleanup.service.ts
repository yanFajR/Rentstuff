import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service.js';

const MINIMUM_INTERVAL_MS = 60_000;

@Injectable()
export class SessionCleanupService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SessionCleanupService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    const configured =
      this.configService.get<number>('session.cleanupIntervalMs') ?? 60 * 60 * 1_000;
    const intervalMs = Math.max(MINIMUM_INTERVAL_MS, configured);

    void this.cleanupExpiredSessions();
    this.timer = setInterval(() => {
      void this.cleanupExpiredSessions();
    }, intervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async cleanupExpiredSessions(): Promise<number> {
    try {
      const result = await this.prisma.session.deleteMany({
        where: { expiresAt: { lte: new Date() } },
      });
      if (result.count > 0) {
        this.logger.log(`${result.count} session kedaluwarsa dibersihkan`);
      }
      return result.count;
    } catch (error) {
      this.logger.error(
        'Pembersihan session kedaluwarsa gagal',
        error instanceof Error ? error.stack : String(error),
      );
      return 0;
    }
  }
}
