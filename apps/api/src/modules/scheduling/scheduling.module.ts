import { Module } from '@nestjs/common';
import { AppointmentsModule } from './appointments/appointments.module';
import { ChairsModule } from './chairs/chairs.module';

@Module({
  imports: [AppointmentsModule, ChairsModule],
})
export class SchedulingModule {}
