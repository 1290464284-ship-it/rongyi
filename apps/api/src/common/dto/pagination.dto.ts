import { Type } from 'class-transformer';
import { IsInt, IsOptional, Min, Max, IsString } from 'class-validator';

export const MAX_PAGE_SIZE = 200;

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number = 20;

  @IsOptional()
  @IsString()
  sortBy?: string;

  @IsOptional()
  @IsString()
  sortOrder?: 'ASC' | 'DESC';

  @IsOptional()
  @IsString()
  keyword?: string;
}

export class DateRangeQueryDto {
  @IsOptional()
  @IsString()
  startDate?: string;

  @IsOptional()
  @IsString()
  endDate?: string;
}

export class PaginationResultDto<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
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
