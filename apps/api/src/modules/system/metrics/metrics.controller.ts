import { Controller, Get, Res } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Response } from 'express';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { MetricsService } from './metrics.service';

@ApiTags('指标监控')
@Controller('metrics')
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @ApiOperation({ summary: '获取指标数据' })
  @Get()
  @Roles(Role.BOSS)
  @ApiOperation({ summary: '获取 Prometheus 格式指标' })
  getMetrics(@Res() res: Response) {
    const metrics = this.metricsService.getMetrics();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics);
  }

  @ApiOperation({ summary: 'resetMetrics - 指标' })
  @Get('reset')
  @Roles(Role.BOSS)
  @ApiOperation({ summary: '重置指标计数器' })
  resetMetrics() {
    this.metricsService.resetMetrics();
    return { success: true, message: '指标已重置' };
  }
}
