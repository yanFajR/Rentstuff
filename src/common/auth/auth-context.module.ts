import { Global, Module } from '@nestjs/common';
import { TenantAuthGuard } from './tenant-auth.guard.js';

@Global()
@Module({
  providers: [TenantAuthGuard],
  exports: [TenantAuthGuard],
})
export class AuthContextModule {}
