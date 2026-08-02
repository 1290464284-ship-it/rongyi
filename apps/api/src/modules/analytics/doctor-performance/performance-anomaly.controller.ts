import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { PerformanceAnomalyService } from './performance-anomaly.service';
import { ComputeDoctorMetricsDto } from './dto/compute-metrics.dto';
import { ListAnomaliesDto } from './dto/list-anomalies.dto';
import { ResolveAnomalyDto } from './dto/resolve-anomaly.dto';

@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('医生业绩异常检测')
@Controller('analytics/doctor-performance')
export class PerformanceAnomalyController {
  constructor(private performanceAnomalyService: PerformanceAnomalyService) {}

  @ApiOperation({ summary: '手动触发指定医生的指标计算与异常检测' })
  @Post('detect')
  async detectForDoctor(@Body() dto: ComputeDoctorMetricsDto) {
    if (dto.doctorId) {
      const anomalies = this.performanceAnomalyService.detectAnomaliesForDoctor(
        dto.doctorId, dto.windowDays ?? 30,
      );
      return { doctorId: dto.doctorId, anomalies };
    }
    return this.performanceAnomalyService.batchDetectAnomalies();
  }

  @ApiOperation({ summary: '批量检测所有医生业绩异常（用于 Cron）' })
  @Post('batch-detect')
  async batchDetect() {
    return this.performanceAnomalyService.batchDetectAnomalies();
  }

  @ApiOperation({ summary: '查询异常列表' })
  @Get('anomalies')
  listAnomalies(@Query() dto: ListAnomaliesDto) {
    return this.performanceAnomalyService.listAnomalies({
      severity: dto.severity,
      resolved: dto.resolved,
      doctorId: dto.doctorId,
      page: dto.page,
      pageSize: dto.pageSize,
    });
  }

  @ApiOperation({ summary: '标记异常为已解决' })
  @Patch('anomalies/:id/resolve')
  async resolve(@Param('id') id: string, @Body() dto: ResolveAnomalyDto) {
    await this.performanceAnomalyService.resolve(id, dto.note);
    return { success: true, id };
  }
}
