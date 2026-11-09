import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import type { HealthProbeResult, LivenessReport, ReadinessReport } from './health.types.js';

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  liveness(): LivenessReport {
    return {
      status: 'ok',
      service: 'rental-reminder',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.max(0, Math.round(process.uptime())),
    };
  }

  async readiness(): Promise<ReadinessReport> {
    const probe = await this.probeDatabase();
    return {
      status: probe.healthy ? 'ok' : 'unavailable',
      timestamp: probe.timestamp.toISOString(),
    };
  }

  async checkReadiness(): Promise<HealthProbeResult> {
    return this.probeDatabase();
  }

  private async probeDatabase(): Promise<HealthProbeResult> {
    const startedAt = performance.now();
    const timestamp = new Date();

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return {
        healthy: true,
        latencyMs: Math.round(performance.now() - startedAt),
        timestamp,
      };
    } catch (error) {
      this.logger.error(
        'Pemeriksaan kesiapan database gagal',
        error instanceof Error ? error.stack : String(error),
      );
      return {
        healthy: false,
        latencyMs: null,
        timestamp,
      };
    }
  }
}
