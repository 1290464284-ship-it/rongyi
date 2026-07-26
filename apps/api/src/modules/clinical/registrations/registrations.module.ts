import { Module } from '@nestjs/common';
import { RegistrationsController } from './registrations.controller';
import { RegistrationsService } from './registrations.service';
import { VisitsModule } from '../visits/visits.module';
import { AppointmentsModule } from '../../scheduling/appointments/appointments.module';

@Module({
  imports: [VisitsModule, AppointmentsModule],
  controllers: [RegistrationsController],
  providers: [RegistrationsService],
  exports: [RegistrationsService],
})
export class RegistrationsModule {}
