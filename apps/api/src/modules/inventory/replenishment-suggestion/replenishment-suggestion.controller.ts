import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { ReplenishmentSuggestionService } from './replenishment-suggestion.service';
import { GenerateSuggestionsDto } from './dto/generate-suggestions.dto';
import { ListSuggestionsDto } from './dto/list-suggestions.dto';
import { ApplySuggestionsDto } from './dto/apply-suggestions.dto';
import { IgnoreSuggestionsDto } from './dto/ignore-suggestions.dto';

@Roles(Role.BOSS)
@ApiTags('库存补货建议')
@OperationLogResource('库存补货建议')
@Controller('inventory/replenishment-suggestions')
export class ReplenishmentSuggestionController {
  constructor(private readonly suggestionService: ReplenishmentSuggestionService) {}

  @ApiOperation({ summary: '生成库存补货建议（全量扫描）' })
  @Post('generate')
  generate(@Body() dto: GenerateSuggestionsDto) {
    return this.suggestionService.generateSuggestions(dto);
  }

  @ApiOperation({ summary: '分页查询补货建议列表' })
  @Get()
  list(@Query() dto: ListSuggestionsDto) {
    return this.suggestionService.list(dto);
  }

  @ApiOperation({ summary: '批量应用建议转采购单' })
  @Post('apply')
  apply(@Body() dto: ApplySuggestionsDto, _req: ExpressRequest) {
    return this.suggestionService.applyToPurchaseOrder(dto.ids, {
      groupBySupplier: dto.groupBySupplier ?? true,
      supplierIdFallback: dto.supplierIdFallback,
    });
  }

  @ApiOperation({ summary: '批量忽略建议' })
  @Post('ignore')
  ignore(@Body() dto: IgnoreSuggestionsDto) {
    return this.suggestionService.ignoreSuggestions(dto.ids);
  }
}
