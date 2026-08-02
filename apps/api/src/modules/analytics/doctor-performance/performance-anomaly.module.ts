import { Module } from '@nestjs/common';
import { PerformanceAnomalyController } from './performance-anomaly.controller';
import { PerformanceAnomalyService } from './performance-anomaly.service';
import { DbModule } from '../../../db/db.module';
import { CommonServicesModule } from '../../../common/services/common-services.module';
import { SettingsModule } from '../../system/settings/settings.module';

@Module({
  imports: [DbModule, CommonServicesModule, SettingsModule],
  controllers: [PerformanceAnomalyController],
  providers: [PerformanceAnomalyService],
  exports: [PerformanceAnomalyService],
})
export class DoctorPerformanceModule {}
