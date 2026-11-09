import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { REMINDER_TIMEZONE } from './reminder-rules.js';
import { ReminderSchedulerService } from './reminder-scheduler.service.js';

@Injectable()
export class ReminderScheduler {
  private readonly logger = new Logger(ReminderScheduler.name);

  constructor(private readonly schedulerService: ReminderSchedulerService) {}

  @Cron('0 9 * * *', {
    name: 'daily-reminder',
    timeZone: REMINDER_TIMEZONE,
  })
  async runDaily(): Promise<void> {
    try {
      const result = await this.schedulerService.runOnce();
      this.logger.log(
        `Pengingat harian ${result.todayDate}: ${result.created} dibuat, ` +
          `${result.promoted} siap, ${result.skipped} dilewati, ` +
          `${result.reactivated} diaktifkan kembali.`,
      );
    } catch (error) {
      this.logger.error(
        `Pengingat harian gagal: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
