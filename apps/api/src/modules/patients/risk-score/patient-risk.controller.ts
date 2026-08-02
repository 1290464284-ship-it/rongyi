import { Controller, Get, Param, Post, Query, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { PatientRiskService } from './patient-risk.service';

@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('患者风险评分')
@OperationLogResource('患者风险评分')
@Controller('patients/risk-score')
export class PatientRiskController {
  constructor(private patientRiskService: PatientRiskService) {}

  @ApiOperation({ summary: '获取患者最新风险评分' })
  @Get(':patientId')
  async getLatest(@Param('patientId') patientId: string) {
    return this.patientRiskService.getLatest(patientId);
  }

  @ApiOperation({ summary: '强制重算患者风险评分' })
  @Post(':patientId')
  @HttpCode(200)
  async recalculate(@Param('patientId') patientId: string) {
    return this.patientRiskService.calculateAndSave(patientId);
  }

  @ApiOperation({ summary: '获取患者风险评分历史快照列表' })
  @Get('history/:patientId')
  async getHistory(
    @Param('patientId') patientId: string,
    @Query('page') page: string | undefined,
    @Query('pageSize') pageSize: string | undefined,
  ) {
    const p = page ? Number(page) : 1;
    const ps = pageSize ? Number(pageSize) : 20;
    return this.patientRiskService.getHistory(patientId, p, ps);
  }
}
