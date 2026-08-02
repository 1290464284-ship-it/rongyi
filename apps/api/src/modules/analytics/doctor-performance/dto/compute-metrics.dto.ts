import { IsOptional, IsString, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

const _METRICS = ['REVENUE_30D', 'VISITS_30D', 'NO_SHOW_RATE_30D', 'AVG_AOV_30D'] as const;
export type PerfMetric = typeof _METRICS[number];

export class ComputeDoctorMetricsDto {
  @ApiProperty({ description: '医生ID（可选，不传则处理所有医生）', required: false })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiProperty({ description: '窗口天数（默认30）', example: 30, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(7)
  windowDays?: number;
}
