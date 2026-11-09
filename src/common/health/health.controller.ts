import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
import { formatDateTime, formatUptime } from '../helpers/format.js';
import { HealthService } from './health.service.js';
import type { LivenessReport, ReadinessReport } from './health.types.js';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  check(): LivenessReport {
    return this.healthService.liveness();
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) response: Response): Promise<ReadinessReport> {
    const report = await this.healthService.readiness();
    response.status(report.status === 'ok' ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    return report;
  }

  @Get('partial')
  async showPartial(@Res() response: Response): Promise<void> {
    const probe = await this.healthService.checkReadiness();
    const isHealthy = probe.healthy;

    response.status(isHealthy ? HttpStatus.OK : HttpStatus.SERVICE_UNAVAILABLE);
    response.render('health/status', {
      pageTitle: 'Status sistem',
      pageSubtitle: '',
      activeNav: '',
      isHealthy,
      checkedAt: formatDateTime(probe.timestamp),
      uptimeLabel: formatUptime(Math.max(0, Math.round(process.uptime()))),
    });
  }
}
