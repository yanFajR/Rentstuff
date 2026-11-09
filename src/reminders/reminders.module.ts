import { Module } from '@nestjs/common';

import { ReminderController } from './reminder.controller.js';
import { ReminderSchedulerService } from './reminder-scheduler.service.js';
import { ReminderScheduler } from './reminder.scheduler.js';
import { ReminderService } from './reminder.service.js';

@Module({
  controllers: [ReminderController],
  providers: [ReminderService, ReminderSchedulerService, ReminderScheduler],
  exports: [ReminderService, ReminderSchedulerService],
})
export class RemindersModule {}
