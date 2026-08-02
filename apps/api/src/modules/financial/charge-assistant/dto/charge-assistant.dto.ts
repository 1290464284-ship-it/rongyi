import { IsString, IsOptional, IsArray, Min, ValidateNested, IsInt, MaxLength, ArrayMinSize, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { MAX_PAGE_SIZE } from '../../../../common/constants/pagination';

export class SelectedChargeItemDto {
  @ApiProperty({ description: '治疗目录编码（优先使用）', example: 'RCT-001', required: false })
  @IsOptional() @IsString() @MaxLength(100)
  treatmentCatalogCode?: string;

  @ApiProperty({ description: '项目名称', example: '洁牙' })
  @IsString() @MaxLength(200)
  name!: string;
}

export class RecommendChargeItemsDto {
  @ApiProperty({ description: '已选项目列表', type: () => [SelectedChargeItemDto] })
  @IsArray() @ValidateNested({ each: true }) @Type(() => SelectedChargeItemDto)
  selectedItems!: SelectedChargeItemDto[];

  @ApiProperty({ description: '推荐数量上限', example: 3, required: false })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20)
  topK?: number;
}

export class IgnoreRecommendationDto {
  @ApiProperty({ description: '前项目keys（normalize 后的）', example: ['NAME:洁牙', 'NAME:抛光'] })
  @IsArray() @ArrayMinSize(1) @IsString({ each: true })
  antecedentKeys!: string[];

  @ApiProperty({ description: '后项key（normalize 后的）', example: 'NAME:上药' })
  @IsString() @MaxLength(500)
  consequentKey!: string;
}

export class RebuildRecommendationsDto {
  @ApiProperty({ description: '回溯天数（覆盖设置）', example: 730, required: false })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(3650)
  sinceDays?: number;
}

export class QueryRulesDto {
  @ApiProperty({ description: '页码', example: 1, required: false })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number;

  @ApiProperty({ description: '每页数量', example: 50, required: false })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PAGE_SIZE)
  pageSize?: number;
}
