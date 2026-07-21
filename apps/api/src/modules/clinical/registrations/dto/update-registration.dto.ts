import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { RegistrationStatus, RegistrationType } from '../../../../common/types/enums';
import { CreateRegistrationDto } from './create-registration.dto';

export class UpdateRegistrationDto extends OmitType(PartialType(CreateRegistrationDto), [
  'patientId',
] as const) {
  @IsOptional()
  @IsEnum(RegistrationStatus)
  status?: RegistrationStatus;

  @IsOptional()
  @IsEnum(RegistrationType)
  type?: RegistrationType;

  @IsOptional()
  @IsString()
  triageNote?: string;
}
