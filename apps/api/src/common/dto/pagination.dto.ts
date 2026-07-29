import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min, Max, IsString, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { MAX_PAGE_SIZE } from '../constants/pagination';

export { MAX_PAGE_SIZE };

export class PaginationQueryDto {
  @ApiProperty({ description: '页码', example: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ description: '每页数量', example: 20, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number = 20;

  @ApiProperty({ description: '排序字段', example: 'createdAt', required: false })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiProperty({ description: '排序方向', enum: ['ASC', 'DESC', 'asc', 'desc'], example: 'DESC', required: false })
  @IsOptional()
  @IsIn(['ASC', 'DESC', 'asc', 'desc'])
  sortOrder?: 'ASC' | 'DESC';

  @ApiProperty({ description: '搜索关键词', example: '张三', required: false })
  @IsOptional()
  @IsString()
  keyword?: string;
}

export class DateRangeQueryDto {
  @ApiProperty({ description: '开始日期', example: '2024-01-01', required: false })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiProperty({ description: '结束日期', example: '2024-01-31', required: false })
  @IsOptional()
  @IsString()
  endDate?: string;
}

export class PaginationResultDto<T> {
  items!: T[];
  total!: number;
  page!: number;
  pageSize!: number;
}

/** 安全解析分页参数，防止NaN注入 */
export function safePage(rawPage: unknown, defaultPage = 1): number {
  const n = Number(rawPage);
  if (!Number.isFinite(n) || n < 1) return defaultPage;
  return Math.floor(n);
}

export function safePageSize(rawPageSize: unknown, defaultPageSize = 20): number {
  const n = Number(rawPageSize);
  if (!Number.isFinite(n) || n < 1) return defaultPageSize;
  return Math.min(MAX_PAGE_SIZE, Math.floor(n));
}
