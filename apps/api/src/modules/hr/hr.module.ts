import { Module } from '@nestjs/common';
import { WorkScheduleController } from './work-schedule.controller';
import { AttendanceController } from './attendance.controller';
import { LeaveRequestController } from './leave-request.controller';
import { WorkScheduleService } from './work-schedule.service';
import { LeaveRequestService } from './leave-request.service';
import { SettingsModule } from '../system/settings/settings.module';

@Module({
  imports: [SettingsModule],
  controllers: [
    WorkScheduleController,
    AttendanceController,
    LeaveRequestController,
  ],
  providers: [
    WorkScheduleService,
    LeaveRequestService,
  ],
  exports: [
    WorkScheduleService,
    LeaveRequestService,
  ],
})
export class HrModule {}
