import { Body, Controller, Get, Post, Query, Request } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { BusinessValidationException } from '@common/errors';
import { ChargeAssistantService, normalizeItemKey, RecommendationResult } from './charge-assistant.service';
import {
  RecommendChargeItemsDto,
  IgnoreRecommendationDto,
  RebuildRecommendationsDto,
  QueryRulesDto,
} from './dto/charge-assistant.dto';

@Roles(Role.BOSS, Role.RECEPTIONIST, Role.DOCTOR)
@ApiTags('收费智能补全')
@Controller('financial/charge-assistant')
export class ChargeAssistantController {
  constructor(
    private chargeAssistantService: ChargeAssistantService,
  ) {}

  @ApiOperation({ summary: '基于已选项目推荐关联收费项目' })
  @Post('recommend')
  async recommend(
    @Body() dto: RecommendChargeItemsDto,
  ): Promise<RecommendationResult[]> {
    const normalizedKeys = (dto.selectedItems || []).map(item => normalizeItemKey(item));
    return this.chargeAssistantService.recommendChargeItems(normalizedKeys, {
      topK: dto.topK,
    });
  }

  @ApiOperation({ summary: '忽略某条推荐规则' })
  @Post('ignore')
  ignore(
    @Body() dto: IgnoreRecommendationDto,
    @Request() req: ExpressRequest,
  ): { success: boolean } {
    const userId = (req.user as { id?: string } | undefined)?.id;
    if (!userId) throw new BusinessValidationException('用户身份无效');
    this.chargeAssistantService.ignoreRecommendation(
      dto.antecedentKeys,
      dto.consequentKey,
      userId,
    );
    return { success: true };
  }

  @Roles(Role.BOSS, Role.ADMIN)
  @ApiOperation({ summary: '重建关联规则（Apriori 重算）' })
  @Post('rebuild')
  rebuild(
    @Body() dto: RebuildRecommendationsDto,
  ) {
    return this.chargeAssistantService.rebuildRecommendations(dto.sinceDays);
  }

  @ApiOperation({ summary: '分页查询已生成的关联规则' })
  @Get('rules')
  listRules(
    @Query() q: QueryRulesDto,
  ) {
    return this.chargeAssistantService.listRules(q.page, q.pageSize);
  }
}
