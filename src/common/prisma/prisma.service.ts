import { Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor(private readonly configService: ConfigService) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.configureSqlite();
    this.logger.log('Koneksi database Prisma siap');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Koneksi database Prisma ditutup');
  }

  private async configureSqlite(): Promise<void> {
    if (this.configService.get<string>('database.provider') !== 'sqlite') {
      return;
    }

    const journalMode = this.configService.get<string>('database.journalMode') ?? 'WAL';
    const busyTimeoutMs = this.configService.get<number>('database.busyTimeoutMs') ?? 5_000;

    const rows = await this.$queryRawUnsafe<Array<{ journal_mode: string }>>(
      `PRAGMA journal_mode = ${journalMode}`,
    );
    await this.$queryRawUnsafe(`PRAGMA busy_timeout = ${Math.max(0, busyTimeoutMs)}`);
    await this.$queryRawUnsafe('PRAGMA foreign_keys = ON');

    this.logger.log(
      `SQLite siap: journal_mode=${rows[0]?.journal_mode ?? journalMode}, ` +
        `busy_timeout=${Math.max(0, busyTimeoutMs)}ms, foreign_keys=ON`,
    );
  }
}
