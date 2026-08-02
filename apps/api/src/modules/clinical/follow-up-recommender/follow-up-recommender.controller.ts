import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { FollowUpRecommenderService, FollowUpRecommendResult } from './follow-up-recommender.service';
import {
  VisitRecommendApplyDto,
  BatchGenerateOptionsDto,
  GetNextRemindersQueryDto,
  BatchGenerateResultDto,
  FollowUpRecommendResultDto,
} from './dto/follow-up-recommender.dto';

@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST, Role.NURSE)
@ApiTags('复诊时机推荐')
@OperationLogResource('复诊推荐')
@Controller('clinical/follow-up-recommendations')
export class FollowUpRecommenderController {
  constructor(private readonly service: FollowUpRecommenderService) {}

  @ApiOperation({ summary: '基于就诊ID推荐复诊时机' })
  @Post('visit/:visitId')
  async recommendForVisit(
    @Param('visitId') visitId: string,
  ): Promise<FollowUpRecommendResultDto[]> {
    const raw = await this.service.recommendForVisit(visitId);
    return raw.map(r => ({
      templateId: r.templateId,
      templateName: r.templateName,
      recommendedDate: r.recommendedDate,
      reason: r.reason,
      confidence: r.confidence,
    }));
  }

  @ApiOperation({ summary: '应用推荐结果，批量创建随访任务与分配记录' })
  @Post('apply')
  async apply(
    @Body() body: VisitRecommendApplyDto & { visitId?: string; recommendations?: FollowUpRecommendResult[] },
  ) {
    const recs: FollowUpRecommendResult[] = (body.recommendations ?? []);
    return this.service.applyRecommendations(recs, {
      assigneeId: body.assigneeId,
      visitId: body.visitId,
    });
  }

  @Roles(Role.BOSS, Role.ADMIN)
  @ApiOperation({ summary: '批量生成复诊推荐（Cron用，仅老板/管理员）' })
  @Post('batch-generate')
  async batchGenerate(
    @Body() body: BatchGenerateOptionsDto,
  ): Promise<BatchGenerateResultDto> {
    return this.service.batchGenerate(body.limit ?? 200);
  }

  @ApiOperation({ summary: '获取未来14天内/逾期的待随访提醒' })
  @Get('next-reminders')
  async getNextReminders(
    @Query() q: GetNextRemindersQueryDto,
  ) {
    return this.service.getNextReminders({
      patientId: q.patientId,
      limit: q.limit ?? 50,
      overdueOnly: q.overdueOnly ?? false,
    });
  }
}
