import { IsEnum, IsOptional, IsString } from 'class-validator';
import { PlanItemStatus } from '../../../../common/types/enums';

export class UpdatePlanItemStatusDto {
  @IsEnum(PlanItemStatus)
  status!: PlanItemStatus;

  @IsOptional()
  @IsString()
  treatmentId?: string;
}
