import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PlanItemStatus } from '@dental/shared';

export class UpdatePlanItemStatusDto {
  @ApiProperty({ description: '计划项目状态', enum: PlanItemStatus, example: PlanItemStatus.COMPLETED })
  @IsEnum(PlanItemStatus)
  status!: PlanItemStatus;

  @ApiProperty({ description: '关联治疗ID', example: 'treatment-uuid-001', required: false })
  @IsOptional()
  @IsString()
  treatmentId?: string;
}
