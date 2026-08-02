import { IsOptional, IsString, IsNumber, IsIn, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

const VALID_STATUS = ['OPEN', 'APPLIED', 'IGNORED', 'EXPIRED'] as const;
const VALID_REASON = ['ROP_BELOW_MIN', 'ZERO_STOCK', 'EXPIRING_30D', 'USAGE_SPIKE'] as const;
const VALID_SORT_BY = ['createdAt', 'suggestedQty', 'totalAmount'] as const;
const VALID_SORT_ORDER = ['ASC', 'DESC'] as const;

export class ListSuggestionsDto {
  @ApiProperty({ description: '状态过滤', enum: VALID_STATUS, required: false })
  @IsOptional()
  @IsString()
  @IsIn(VALID_STATUS)
  status?: typeof VALID_STATUS[number];

  @ApiProperty({ description: '触发原因过滤', enum: VALID_REASON, required: false })
  @IsOptional()
  @IsString()
  @IsIn(VALID_REASON)
  reason?: typeof VALID_REASON[number];

  @ApiProperty({ description: '页码', example: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ description: '每页数量', example: 20, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  pageSize?: number = 20;

  @ApiProperty({ description: '排序字段', enum: VALID_SORT_BY, example: 'createdAt', required: false })
  @IsOptional()
  @IsString()
  @IsIn(VALID_SORT_BY)
  sortBy?: typeof VALID_SORT_BY[number] = 'createdAt';

  @ApiProperty({ description: '排序方向', enum: VALID_SORT_ORDER, example: 'DESC', required: false })
  @IsOptional()
  @IsString()
  @IsIn(VALID_SORT_ORDER)
  sortOrder?: typeof VALID_SORT_ORDER[number] = 'DESC';
}
