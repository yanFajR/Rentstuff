import { Global, Module } from '@nestjs/common';
import { FormValidationService } from './form-validation.service.js';

@Global()
@Module({
  providers: [FormValidationService],
  exports: [FormValidationService],
})
export class ValidationModule {}
