import { IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class GenerateSuggestionsDto {
  @ApiProperty({ description: '回溯天数（默认90天）', example: 90, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(7)
  lookbackDays?: number = 90;

  @ApiProperty({ description: '默认提前期天数（默认7天）', example: 7, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  leadTimeDaysDefault?: number = 7;

  @ApiProperty({ description: '安全系数（默认1.5）', example: 1.5, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  safetyFactor?: number = 1.5;
}
