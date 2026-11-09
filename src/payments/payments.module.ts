import { Module } from '@nestjs/common';

import { InvoicesModule } from '../invoices/invoices.module.js';
import { RemindersModule } from '../reminders/reminders.module.js';
import { PaymentController } from './payment.controller.js';
import { PaymentService } from './payment.service.js';

@Module({
  imports: [InvoicesModule, RemindersModule],
  controllers: [PaymentController],
  providers: [PaymentService],
  exports: [PaymentService],
})
export class PaymentsModule {}
