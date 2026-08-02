import { Module } from '@nestjs/common';
import { PrescriptionSafetyService } from './prescription-safety.service';
import { SettingsModule } from '../../system/settings/settings.module';
import { DbModule } from '../../../db/db.module';
import { CommonServicesModule } from '../../../common/services/common-services.module';

@Module({
  imports: [SettingsModule, DbModule, CommonServicesModule],
  providers: [PrescriptionSafetyService],
  exports: [PrescriptionSafetyService],
})
export class PrescriptionSafetyModule {}
