import { Module } from '@nestjs/common';

import { InvoicesModule } from '../invoices/invoices.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { RemindersModule } from '../reminders/reminders.module.js';
import { ReportsModule } from '../reports/reports.module.js';
import { DashboardController } from './dashboard.controller.js';
import { DashboardService } from './dashboard.service.js';

@Module({
  imports: [InvoicesModule, PaymentsModule, RemindersModule, ReportsModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
