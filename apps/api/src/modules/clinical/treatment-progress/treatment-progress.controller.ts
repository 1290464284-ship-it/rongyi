import { Controller, Get, Post, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { TreatmentProgressService } from './treatment-progress.service';
import { QueryDoctorDashboardDto, QueryTrendDto, FlagOverduePlanDto } from './dto/trend.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';

@ApiTags('治疗进度看板')
@OperationLogResource('治疗进度看板')
@Controller()
@Roles(Role.BOSS, Role.DOCTOR)
export class TreatmentProgressController {
  constructor(private readonly service: TreatmentProgressService) {}

  @ApiOperation({ summary: '查询疗程进度详情' })
  @Get('plans/:planId/progress')
  getPlanProgress(@Param('planId') planId: string) {
    return this.service.calcPlanProgress(planId);
  }

  @ApiOperation({ summary: '医生级进度看板' })
  @Get('dashboard/doctor')
  getDoctorDashboard(@Query() query: QueryDoctorDashboardDto) {
    return this.service.doctorDashboard({
      doctorId: query.doctorId,
      fromDate: query.fromDate,
      toDate: query.toDate,
    });
  }

  @ApiOperation({ summary: '诊所级进度看板' })
  @Get('dashboard/clinic')
  getClinicDashboard() {
    return this.service.clinicDashboard();
  }

  @ApiOperation({ summary: '生成当日进度快照（管理员/Cron调用）' })
  @Post('snapshot/today')
  @Roles(Role.BOSS)
  createSnapshotToday() {
    return this.service.snapshotToday();
  }

  @ApiOperation({ summary: '进度趋势（回溯N日）' })
  @Get('trend')
  getTrend(@Query() query: QueryTrendDto) {
    return this.service.trend(query.days);
  }

  @ApiOperation({ summary: '标记疗程拖期（审计）' })
  @Post('plans/:planId/flag-overdue')
  flagOverduePlan(@Param('planId') planId: string, @Body() dto: FlagOverduePlanDto) {
    return this.service.flagOverduePlan(planId, dto.note);
  }
}
