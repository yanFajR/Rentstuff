import { Module } from '@nestjs/common';

import { RemindersModule } from '../reminders/reminders.module.js';
import { InvoiceController } from './invoice.controller.js';
import { InvoiceService } from './invoice.service.js';

@Module({
  imports: [RemindersModule],
  controllers: [InvoiceController],
  providers: [InvoiceService],
  exports: [InvoiceService],
})
export class InvoicesModule {}
