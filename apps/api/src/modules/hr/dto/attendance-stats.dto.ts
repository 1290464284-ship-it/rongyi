import { IsDateString, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AttendanceStatsDto {
  @ApiProperty({ description: '开始日期 ISO', example: '2025-03-01T00:00:00' })
  @IsDateString()
  from!: string;

  @ApiProperty({ description: '结束日期 ISO', example: '2025-03-31T23:59:59' })
  @IsDateString()
  to!: string;

  @ApiProperty({ description: '员工ID过滤（可选，不填则全诊所）', example: 'user-uuid-001', required: false })
  @IsOptional()
  @IsString()
  userId?: string;
}
