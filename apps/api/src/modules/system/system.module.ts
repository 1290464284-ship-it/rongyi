import { Module } from '@nestjs/common';
import { SettingsModule } from './settings/settings.module';
import { BackupsModule } from './backups/backups.module';
import { OperationLogsModule } from './operation-logs/operation-logs.module';
import { SearchModule } from './search/search.module';
import { StatsModule } from './stats/stats.module';
import { ClinicsModule } from './clinics/clinics.module';
import { HealthModule } from './health/health.module';
import { MetricsModule } from './metrics/metrics.module';
import { DailySchedulerModule } from './daily-scheduler/daily-scheduler.module';
import { BusinessAlertModule } from './business-alerts/business-alert.module';
import { BulkImportModule } from './bulk-import/bulk-import.module';
import { PrintModule } from './print/print.module';

@Module({
  imports: [
    SettingsModule,
    BackupsModule,
    OperationLogsModule,
    SearchModule,
    StatsModule,
    ClinicsModule,
    HealthModule,
    MetricsModule,
    DailySchedulerModule,
    BusinessAlertModule,
    BulkImportModule,
    PrintModule,
  ],
})
export class SystemModule {}
