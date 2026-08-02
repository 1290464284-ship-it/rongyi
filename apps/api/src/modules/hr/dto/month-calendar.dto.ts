import { IsInt, Min, Max, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class MonthCalendarDto {
  @ApiProperty({ description: '年份', example: 2025 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiProperty({ description: '月份 (1-12)', example: 3 })
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;

  @ApiProperty({ description: '员工ID过滤（可选）', example: 'user-uuid-001', required: false })
  @IsOptional()
  @IsString()
  userId?: string;
}
