import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ROLES } from '@dental/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../common/decorators/operation-log-resource.decorator';
import { WorkScheduleService } from './work-schedule.service';
import { CreateWorkScheduleDto } from './dto/create-work-schedule.dto';
import { UpdateWorkScheduleDto } from './dto/update-work-schedule.dto';
import { ListScheduleDto } from './dto/list-schedule.dto';
import { MonthCalendarDto } from './dto/month-calendar.dto';

@Roles(ROLES.BOSS, ROLES.DOCTOR, ROLES.RECEPTIONIST, ROLES.ADMIN)
@ApiTags('HR 排班管理')
@OperationLogResource('WorkSchedule')
@Controller('hr/schedules')
export class WorkScheduleController {
  constructor(private workScheduleService: WorkScheduleService) {}

  @ApiOperation({ summary: '查询排班列表' })
  @Get()
  list(@Query() query: ListScheduleDto) {
    return this.workScheduleService.listSchedules(query);
  }

  @ApiOperation({ summary: '创建排班' })
  @Post()
  create(@Body() dto: CreateWorkScheduleDto) {
    return this.workScheduleService.createSchedule(dto);
  }

  @ApiOperation({ summary: '更新排班' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkScheduleDto) {
    return this.workScheduleService.updateSchedule(id, dto);
  }

  @ApiOperation({ summary: '删除排班（软删除）' })
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.workScheduleService.deleteSchedule(id);
  }

  @ApiOperation({ summary: '月视图排班日历' })
  @Get('calendar')
  calendar(@Query() query: MonthCalendarDto) {
    return this.workScheduleService.monthCalendar(query);
  }
}
