import { Module } from '@nestjs/common';
import { SatisfactionController } from './satisfaction.controller';
import { SatisfactionService } from './satisfaction.service';
import { DbModule } from '../../../db/db.module';
import { CommonServicesModule } from '../../../common/services/common-services.module';
import { SettingsModule } from '../../system/settings/settings.module';

@Module({
  imports: [DbModule, CommonServicesModule, SettingsModule],
  controllers: [SatisfactionController],
  providers: [SatisfactionService],
  exports: [SatisfactionService],
})
export class SatisfactionModule {}
