import { IsOptional, IsArray, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class ComputeRfmDto {
  @ApiProperty({ description: '指定患者ID列表（可选，不传则处理全部）', required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @Type(() => String)
  patientIds?: string[];

  @ApiProperty({ description: '回看月份数（默认18）', example: 18, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sinceMonths?: number;
}
