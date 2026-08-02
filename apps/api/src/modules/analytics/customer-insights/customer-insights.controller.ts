import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { CustomerInsightsService } from './customer-insights.service';
import { ComputeRfmDto } from './dto/compute-rfm.dto';
import { ListPatientsDto } from './dto/list-patients.dto';

@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('客户洞察 - RFM分层与流失预测')
@Controller('analytics/customer-insights')
export class CustomerInsightsController {
  constructor(private customerInsightsService: CustomerInsightsService) {}

  @ApiOperation({ summary: '手动触发 RFM 计算（指定患者或全部）' })
  @Post('compute-rfm')
  async computeRfm(@Body() dto: ComputeRfmDto) {
    await this.customerInsightsService.computeRfm(dto.patientIds, dto.sinceMonths);
    return { success: true };
  }

  @ApiOperation({ summary: '批量计算 RFM（用于 Cron）' })
  @Post('batch-compute')
  async batchComputeRfm(@Query('limit') limit?: string) {
    const lim = limit ? parseInt(limit, 10) : undefined;
    return this.customerInsightsService.batchComputeRfm(lim);
  }

  @ApiOperation({ summary: '查询患者 RFM 分层与流失概率列表' })
  @Get('patients')
  listPatients(@Query() dto: ListPatientsDto) {
    return this.customerInsightsService.listPatients({
      segment: dto.segment,
      minChurnProb: dto.minChurnProb,
      page: dto.page,
      pageSize: dto.pageSize,
      sortBy: dto.sortByField,
    });
  }
}
