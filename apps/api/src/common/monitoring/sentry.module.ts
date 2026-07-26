import { Module, Global } from '@nestjs/common';
import { ConfigService } from '../services/config.service';
import { SentryService } from './sentry.service';

@Global()
@Module({
  providers: [
    SentryService,
    {
      provide: 'SENTRY_INIT',
      useFactory: (config: ConfigService, sentryService: SentryService) => {
        const dsn = config.get('SENTRY_DSN');
        const environment = config.get('SENTRY_ENV') || config.get('NODE_ENV') || 'development';
        const release = config.get('SENTRY_RELEASE');

        if (dsn && environment !== 'test') {
          sentryService.init(dsn, environment, release);
        }

        return sentryService;
      },
      inject: [ConfigService, SentryService],
    },
  ],
  exports: [SentryService],
})
export class SentryModule {}
