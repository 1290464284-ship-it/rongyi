import { Module } from '@nestjs/common';
import { PatientsController } from './patients.controller';
import { PatientsService } from './patients.service';
import { PatientRepository } from './repositories/patient.repository';
import { StatsModule } from '../system/stats/stats.module';
import { PatientRiskModule } from './risk-score/patient-risk.module';

@Module({
  imports: [StatsModule, PatientRiskModule],
  controllers: [PatientsController],
  providers: [PatientsService, PatientRepository],
  exports: [PatientsService, PatientRiskModule],
})
export class PatientsModule {}
