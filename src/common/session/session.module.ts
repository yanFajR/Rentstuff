import { Global, Module } from '@nestjs/common';
import { CsrfService } from '../security/csrf.service.js';
import { SessionCleanupService } from './session-cleanup.service.js';
import { SessionService } from './session.service.js';

@Global()
@Module({
  providers: [SessionService, CsrfService, SessionCleanupService],
  exports: [SessionService, CsrfService],
})
export class SessionModule {}
