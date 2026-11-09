import { Module, RequestMethod, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';

import { AuthModule } from './auth/auth.module.js';
import { LoginRateLimitMiddleware } from './auth/middleware/login-rate-limit.middleware.js';
import { RegisterRateLimitMiddleware } from './auth/middleware/register-rate-limit.middleware.js';
import { BusinessesModule } from './businesses/businesses.module.js';
import { AuthContextModule } from './common/auth/auth-context.module.js';
import configuration from './common/config/configuration.js';
import { envValidationSchema } from './common/config/env.validation.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { HealthModule } from './common/health/health.module.js';
import { RequestLoggerMiddleware } from './common/middleware/request-logger.middleware.js';
import { ViewLocalsMiddleware } from './common/middleware/view-locals.middleware.js';
import { PrismaModule } from './common/prisma/prisma.module.js';
import { CsrfGuard } from './common/security/csrf.guard.js';
import { ExportRateLimitMiddleware } from './common/security/export-rate-limit.middleware.js';
import { MutationRateLimitMiddleware } from './common/security/mutation-rate-limit.middleware.js';
import { SessionMiddleware } from './common/session/session.middleware.js';
import { SessionModule } from './common/session/session.module.js';
import { ValidationModule } from './common/validation/validation.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { PaymentsModule } from './payments/payments.module.js';
import { RemindersModule } from './reminders/reminders.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { RentalsModule } from './rentals/rentals.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validationSchema: envValidationSchema,
      validationOptions: {
        libraryOptions: {
          abortEarly: false,
        },
      },
    }),
    PrismaModule,
    SessionModule,
    ValidationModule,
    ScheduleModule.forRoot(),
    AuthContextModule,
    HealthModule,
    BusinessesModule,
    CustomersModule,
    RentalsModule,
    InvoicesModule,
    PaymentsModule,
    RemindersModule,
    ReportsModule,
    DashboardModule,
    AuthModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(SessionMiddleware, RequestLoggerMiddleware, ViewLocalsMiddleware)
      .forRoutes({ path: '*splat', method: RequestMethod.ALL });

    consumer
      .apply(LoginRateLimitMiddleware)
      .forRoutes({ path: 'login', method: RequestMethod.POST });

    consumer
      .apply(RegisterRateLimitMiddleware)
      .forRoutes({ path: 'register', method: RequestMethod.POST });

    consumer
      .apply(ExportRateLimitMiddleware)
      .forRoutes({ path: 'reports/export/*splat', method: RequestMethod.GET });

    consumer
      .apply(MutationRateLimitMiddleware)
      .forRoutes({ path: '*splat', method: RequestMethod.POST });
  }
}
