import { Module } from '@nestjs/common';
import { CustomerInsightsController } from './customer-insights.controller';
import { CustomerInsightsService } from './customer-insights.service';
import { DbModule } from '../../../db/db.module';
import { CommonServicesModule } from '../../../common/services/common-services.module';
import { SettingsModule } from '../../system/settings/settings.module';

@Module({
  imports: [DbModule, CommonServicesModule, SettingsModule],
  controllers: [CustomerInsightsController],
  providers: [CustomerInsightsService],
  exports: [CustomerInsightsService],
})
export class CustomerInsightsModule {}
