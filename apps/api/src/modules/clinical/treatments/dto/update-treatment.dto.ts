import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional, IsDateString } from 'class-validator';
import { TreatmentStatus } from '../../../../common/types/enums';
import { CreateTreatmentDto } from './create-treatment.dto';

export class UpdateTreatmentDto extends OmitType(PartialType(CreateTreatmentDto), [
  'patientId',
  'doctorId',
] as const) {
  @IsOptional()
  @IsEnum(TreatmentStatus)
  status?: TreatmentStatus;

  @IsOptional()
  @IsDateString()
  completedDate?: string;
}
