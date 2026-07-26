import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PlanStatus } from '@dental/shared';

export class UpdatePlanStatusDto {
  @ApiProperty({ description: '计划状态', enum: PlanStatus, example: PlanStatus.IN_PROGRESS })
  @IsEnum(PlanStatus)
  status!: PlanStatus;
}
