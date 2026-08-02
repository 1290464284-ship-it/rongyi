import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { SatisfactionService } from './satisfaction.service';
import { SubmitSurveyDto } from './dto/submit-survey.dto';
import { ListSurveysDto } from './dto/list-surveys.dto';
import { CalcNpsDto } from './dto/calc-nps.dto';
import { TrendDto } from './dto/trend.dto';
import { DashboardDto } from './dto/dashboard.dto';
import { DoctorRankDto } from './dto/doctor-rank.dto';

@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@ApiTags('满意度评价 / NPS 系统')
@Controller('analytics/satisfaction')
export class SatisfactionController {
  constructor(private satisfactionService: SatisfactionService) {}

  @ApiOperation({ summary: '提交满意度评价问卷' })
  @Post('surveys')
  async submitSurvey(@Body() dto: SubmitSurveyDto) {
    return this.satisfactionService.submitSurvey(dto);
  }

  @ApiOperation({ summary: '查询满意度评价列表（分页）' })
  @Get('surveys')
  listSurveys(@Query() dto: ListSurveysDto) {
    return this.satisfactionService.listSurveys({
      visitId: dto.visitId,
      patientId: dto.patientId,
      doctorId: dto.doctorId,
      from: dto.from,
      to: dto.to,
      page: dto.page,
      pageSize: dto.pageSize,
    });
  }

  @ApiOperation({ summary: '计算 NPS 与维度平均分' })
  @Get('nps')
  calcNps(@Query() dto: CalcNpsDto) {
    return this.satisfactionService.calcNps({
      from: dto.from,
      to: dto.to,
      doctorId: dto.doctorId,
    });
  }

  @ApiOperation({ summary: 'NPS 近 N 天趋势（缺日用 live 数据补齐）' })
  @Get('nps/trend')
  trend(@Query() dto: TrendDto) {
    return this.satisfactionService.trend(dto.days);
  }

  @ApiOperation({ summary: '满意度仪表盘（总览 NPS、评分、排名、关键词、趋势）' })
  @Get('nps/dashboard')
  dashboard(@Query() dto: DashboardDto) {
    return this.satisfactionService.dashboard({ days: dto.days });
  }

  @ApiOperation({ summary: '医生满意度排名 TOP N（至少 5 份）' })
  @Get('doctors/ranking')
  doctorRank(@Query() dto: DoctorRankDto) {
    return this.satisfactionService.doctorRank(dto.limit);
  }

  @Roles(Role.BOSS, Role.ADMIN)
  @ApiOperation({ summary: '手动触发 NPS 每日快照（Admin / Cron）' })
  @Post('nps/snapshot')
  async snapshotDaily(@Query('day') day?: string) {
    return this.satisfactionService.snapshotDaily(day);
  }
}
