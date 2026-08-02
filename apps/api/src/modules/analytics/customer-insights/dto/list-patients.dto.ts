import { IsOptional, IsString, IsNumber, Min, Max, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

const SEGMENTS = [
  '重要价值', '重要发展', '重要保持', '重要挽留',
  '一般价值', '一般发展', '一般保持', '流失',
] as const;

export type RfmSegment = typeof SEGMENTS[number];

export class ListPatientsDto extends PaginationQueryDto {
  @ApiProperty({ description: 'RFM 分段筛选', enum: SEGMENTS, required: false })
  @IsOptional()
  @IsString()
  @IsIn(SEGMENTS)
  segment?: string;

  @ApiProperty({ description: '最小流失概率（0-1）', example: 0.8, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  minChurnProb?: number;

  @ApiProperty({ description: '排序字段', enum: ['churnProb', 'rfm', 'recency'], example: 'churnProb', required: false })
  @IsOptional()
  @IsString()
  @IsIn(['churnProb', 'rfm', 'recency'])
  sortByField?: 'churnProb' | 'rfm' | 'recency';
}
