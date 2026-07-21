import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { PAGINATION } from '../../../../common/constants/pagination';

export class QueryFirstExamDto {
  @IsOptional() @IsString() patientId?: string;
  @IsOptional() @IsString() doctorId?: string;
  @IsOptional() @IsString() consultantId?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = PAGINATION.DEFAULT_PAGE;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  pageSize?: number = PAGINATION.DEFAULT_PAGE_SIZE;
}
