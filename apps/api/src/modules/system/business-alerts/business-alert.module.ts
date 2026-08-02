import { Module } from '@nestjs/common';
import { DbModule } from '../../../db/db.module';
import { CommonServicesModule } from '../../../common/services/common-services.module';
import { SettingsModule } from '../settings/settings.module';
import { BusinessAlertDetectorService } from './business-alert-detector.service';
import { BusinessAlertsController } from './business-alerts.controller';

@Module({
  imports: [DbModule, CommonServicesModule, SettingsModule],
  providers: [BusinessAlertDetectorService],
  controllers: [BusinessAlertsController],
  exports: [BusinessAlertDetectorService],
})
export class BusinessAlertModule {}
