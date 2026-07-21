import { IsEnum } from 'class-validator';
import { PlanStatus } from '../../../../common/types/enums';

export class UpdatePlanStatusDto {
  @IsEnum(PlanStatus)
  status!: PlanStatus;
}
