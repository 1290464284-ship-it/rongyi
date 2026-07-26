import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { PAGINATION, MAX_PAGE_SIZE } from '../../../../common/constants/pagination';

export class QueryFirstExamDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  @IsOptional() @IsString() patientId?: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional() @IsString() doctorId?: string;

  @ApiProperty({ description: '咨询师ID', example: 'consultant-uuid-001', required: false })
  @IsOptional() @IsString() consultantId?: string;

  @ApiProperty({ description: '初诊状态', example: 'pending', required: false })
  @IsOptional() @IsString() status?: string;

  @ApiProperty({ description: '开始日期', example: '2024-01-01', required: false })
  @IsOptional() @IsString() startDate?: string;

  @ApiProperty({ description: '结束日期', example: '2024-01-31', required: false })
  @IsOptional() @IsString() endDate?: string;

  @ApiProperty({ description: '页码', example: 1, required: false })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page?: number = PAGINATION.DEFAULT_PAGE;

  @ApiProperty({ description: '每页数量', example: 20, required: false })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(MAX_PAGE_SIZE)
  pageSize?: number = PAGINATION.DEFAULT_PAGE_SIZE;
}
