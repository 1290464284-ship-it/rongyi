import { Module } from '@nestjs/common';
import { SettingsModule } from '../../system/settings/settings.module';
import { CommonServicesModule } from '../../../common/services/common-services.module';
import { TreatmentProgressService } from './treatment-progress.service';
import { TreatmentProgressController } from './treatment-progress.controller';

@Module({
  imports: [CommonServicesModule, SettingsModule],
  providers: [TreatmentProgressService],
  controllers: [TreatmentProgressController],
  exports: [TreatmentProgressService],
})
export class TreatmentProgressModule {}
