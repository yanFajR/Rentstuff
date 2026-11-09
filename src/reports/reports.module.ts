import { Module } from '@nestjs/common';

import { ReportsController } from './reports.controller.js';
import { ReportService } from './reports.service.js';

@Module({
  controllers: [ReportsController],
  providers: [ReportService],
  exports: [ReportService],
})
export class ReportsModule {}
