import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class TrendPointDto {
  @ApiProperty({ description: '日期 YYYY-MM-DD' })
  date!: string;

  @ApiProperty({ description: '当日平均完成度' })
  completionAvg!: number;

  @ApiProperty({ description: '当日有逾期的疗程数' })
  overduePlans!: number;

  @ApiProperty({ description: '当日疗程总数（快照中唯一planId的计数）' })
  totalPlans!: number;
}

export class QueryDoctorDashboardDto {
  @ApiProperty({ description: '医生ID，不传则按当前登录医生上下文' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  doctorId?: string;

  @ApiProperty({ description: '统计起始日期 YYYY-MM-DD', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  fromDate?: string;

  @ApiProperty({ description: '统计截止日期 YYYY-MM-DD', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  toDate?: string;
}

export class QueryTrendDto {
  @ApiProperty({ description: '回溯天数，默认30' })
  @IsOptional()
  @Type(() => Number)
  days?: number;
}

export class FlagOverduePlanDto {
  @ApiProperty({ description: '备注说明', required: false, example: '患者临时出差，治疗暂停' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
