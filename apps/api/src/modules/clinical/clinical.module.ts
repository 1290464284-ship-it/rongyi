import { Module } from '@nestjs/common';
import { AppointmentsModule } from '../scheduling/appointments/appointments.module';
import { VisitsModule } from './visits/visits.module';
import { TreatmentsModule } from './treatments/treatments.module';
import { TreatmentPlansModule } from './treatment-plans/treatment-plans.module';
import { RegistrationsModule } from './registrations/registrations.module';
import { OralExaminationsModule } from './oral-examinations/oral-examinations.module';
import { FirstExamsModule } from './first-exams/first-exams.module';
import { PeriodontalRecordsModule } from './periodontal-records/periodontal-records.module';
import { MedicalRecordsModule } from './medical-records/medical-records.module';

@Module({
  imports: [
    AppointmentsModule,
    VisitsModule,
    TreatmentsModule,
    TreatmentPlansModule,
    RegistrationsModule,
    OralExaminationsModule,
    FirstExamsModule,
    PeriodontalRecordsModule,
    MedicalRecordsModule,
  ],
})
export class ClinicalModule {}
