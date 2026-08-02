import { Module } from '@nestjs/common';
import { CommonServicesModule } from '../../../common/services/common-services.module';
import { SettingsModule } from '../../system/settings/settings.module';
import { ChargeAssistantService } from './charge-assistant.service';
import { ChargeAssistantController } from './charge-assistant.controller';

@Module({
  imports: [CommonServicesModule, SettingsModule],
  controllers: [ChargeAssistantController],
  providers: [ChargeAssistantService],
  exports: [ChargeAssistantService],
})
export class ChargeAssistantModule {}
