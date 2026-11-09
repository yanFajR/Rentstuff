import { Module } from '@nestjs/common';

import { CustomersModule } from '../customers/customers.module.js';
import { RentalController } from './rental.controller.js';
import { RentalService } from './rental.service.js';

@Module({
  imports: [CustomersModule],
  controllers: [RentalController],
  providers: [RentalService],
  exports: [RentalService],
})
export class RentalsModule {}
