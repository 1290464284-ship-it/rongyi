import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ROLES } from '@dental/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { WorkScheduleService } from './work-schedule.service';
import { AttendanceStatsDto } from './dto/attendance-stats.dto';

@Roles(ROLES.BOSS, ROLES.DOCTOR, ROLES.RECEPTIONIST, ROLES.ADMIN)
@ApiTags('HR 考勤统计')
@Controller('hr/attendance')
export class AttendanceController {
  constructor(private workScheduleService: WorkScheduleService) {}

  @ApiOperation({ summary: '考勤统计（排班/接诊/请假合并）' })
  @Get()
  stats(@Query() query: AttendanceStatsDto) {
    return this.workScheduleService.attendanceStats(query);
  }
}
