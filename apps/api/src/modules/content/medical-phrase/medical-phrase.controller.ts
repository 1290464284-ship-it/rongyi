import { Controller, Post, Get, Patch, Param, Body, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { MedicalPhraseService } from './medical-phrase.service';
import { ListMedicalPhraseDto, MedicalPhraseScope, MedicalPhraseSort } from './dto/list-medical-phrase.dto';
import { CreateMedicalPhraseDto } from './dto/create-medical-phrase.dto';
import { UpdateMedicalPhraseDto } from './dto/update-medical-phrase.dto';
import { ReorderPinDto } from './dto/reorder-pin.dto';
import { IncUseCountDto } from './dto/inc-use-count.dto';
import { RecommendForTeethDto } from './dto/recommend-for-teeth.dto';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';

@ApiTags('病历短语收藏夹')
@OperationLogResource('病历短语')
@Controller('content/medical-phrases')
@Roles(Role.BOSS, Role.DOCTOR, Role.ADMIN)
export class MedicalPhraseController {
  constructor(private readonly service: MedicalPhraseService) {}

  @ApiOperation({ summary: '查询短语列表（支持分类、关键词、范围、排序）' })
  @Get()
  list(@Query() dto: ListMedicalPhraseDto) {
    return this.service.list({
      category: dto.category,
      keyword: dto.keyword,
      scope: dto.scope ?? MedicalPhraseScope.ALL,
      sort: dto.sort ?? MedicalPhraseSort.PIN_FIRST,
    });
  }

  @ApiOperation({ summary: '创建自定义短语（当前医生私有）' })
  @Post()
  create(@Body() dto: CreateMedicalPhraseDto) {
    return this.service.createCustom(dto);
  }

  @ApiOperation({ summary: '更新短语（仅 owner 或 admin）' })
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateMedicalPhraseDto) {
    return this.service.updatePhrase(id, dto);
  }

  @ApiOperation({ summary: '收藏短语（公共→克隆私有+置顶；重复则重新置顶）' })
  @Post(':id/favorite')
  favorite(@Param('id') id: string) {
    return this.service.favorite(id);
  }

  @ApiOperation({ summary: '取消收藏（软删除，仅本人私有短语）' })
  @Post(':id/unfavorite')
  unfavorite(@Param('id') id: string) {
    return this.service.unfavorite(id);
  }

  @ApiOperation({ summary: '批量调整置顶排序' })
  @Post('reorder-pin')
  reorderPin(@Body() dto: ReorderPinDto) {
    return this.service.reorderPin(dto.entries);
  }

  @ApiOperation({ summary: '批量增加使用计数+最后使用时间' })
  @Post('inc-use-count')
  incUseCount(@Body() dto: IncUseCountDto) {
    return this.service.incUseCount(dto.phraseIds);
  }

  @ApiOperation({ summary: '按患者牙位状态推荐匹配的短语' })
  @ApiQuery({ name: 'toothNumbers', required: false, type: 'string', example: '16,26' })
  @Get('recommend-for-teeth')
  recommendForTeeth(@Query() dto: RecommendForTeethDto) {
    const selectedToothNumbers = dto.toothNumbers
      ? dto.toothNumbers.split(',').filter(Boolean).map(n => parseInt(n.trim(), 10))
      : undefined;
    return this.service.recommendForTeeth({
      patientId: dto.patientId,
      selectedToothNumbers,
    });
  }
}
