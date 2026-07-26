import { Module } from '@nestjs/common';
import { SettingsController } from './settings.controller';
import { SettingsService } from './settings.service';
import { DbModule } from '../../../db/db.module';
import { CommonServicesModule } from '../../../common/services/common-services.module';

@Module({
  imports: [DbModule, CommonServicesModule],
  controllers: [SettingsController],
  providers: [SettingsService],
})
export class SettingsModule {}
