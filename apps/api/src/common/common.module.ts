import { Global, Module } from '@nestjs/common';
import { ClinicContextService } from './services/clinic-context.service';
import { IdempotencyService } from './services/idempotency.service';
import { AppLogger } from './services/logger.service';
import { AlertService } from './services/alert.service';
import { ConfigValidationService } from './services/config-validation.service';
import { ConfigService } from './services/config.service';
import { SentryModule } from './monitoring/sentry.module';

@Global()
@Module({
  imports: [SentryModule],
  providers: [
    ConfigService,
    ClinicContextService,
    IdempotencyService,
    AppLogger,
    AlertService,
    ConfigValidationService,
  ],
  exports: [
    ConfigService,
    ClinicContextService,
    IdempotencyService,
    AppLogger,
    AlertService,
    ConfigValidationService,
    SentryModule,
  ],
})
export class CommonModule {}
