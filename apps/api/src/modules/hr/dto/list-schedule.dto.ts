import { IsString, IsOptional, IsDateString, IsInt, Min, Max } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ListScheduleDto {
  @ApiProperty({ description: '开始日期 ISO', example: '2025-03-01T00:00:00', required: false })
  @IsOptional()
  @IsDateString()
  from?: string;

  @ApiProperty({ description: '结束日期 ISO', example: '2025-03-31T23:59:59', required: false })
  @IsOptional()
  @IsDateString()
  to?: string;

  @ApiProperty({ description: '员工ID过滤', example: 'user-uuid-001', required: false })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ description: '页码', example: 1, required: false, default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ description: '每页数量', example: 20, required: false, default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(500)
  pageSize?: number;
}
