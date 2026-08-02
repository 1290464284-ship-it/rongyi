import { Module } from '@nestjs/common';
import { PatientRiskService } from './patient-risk.service';
import { PatientRiskController } from './patient-risk.controller';
import { SettingsModule } from '../../system/settings/settings.module';
import { DbModule } from '../../../db/db.module';
import { CommonServicesModule } from '../../../common/services/common-services.module';

@Module({
  imports: [SettingsModule, DbModule, CommonServicesModule],
  controllers: [PatientRiskController],
  providers: [PatientRiskService],
  exports: [PatientRiskService],
})
export class PatientRiskModule {}
