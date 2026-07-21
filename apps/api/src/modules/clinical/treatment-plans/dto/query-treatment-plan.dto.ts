import { IsOptional, IsString, IsEnum } from 'class-validator';
import { PlanStatus } from '../../../../common/types/enums';
import { BaseQueryDto } from '../../../../common/dto/base-query.dto';

export class QueryTreatmentPlanDto extends BaseQueryDto {
  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsEnum(PlanStatus)
  status?: PlanStatus;
}
