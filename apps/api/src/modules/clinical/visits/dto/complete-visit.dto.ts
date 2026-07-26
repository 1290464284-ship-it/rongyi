import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompleteVisitDto {
  @ApiProperty({ description: '诊断结果', example: '16深龋，26中龋', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  diagnosis?: string;

  @ApiProperty({ description: '治疗计划', example: '16树脂充填，26建议观察', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  treatmentPlan?: string;
}
