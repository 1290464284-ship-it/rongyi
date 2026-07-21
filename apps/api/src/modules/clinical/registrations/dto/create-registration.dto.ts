import { IsString, IsEnum, IsOptional } from 'class-validator';
import { RegistrationType } from '../../../../common/types/enums';

export class CreateRegistrationDto {
  @IsString()
  patientId!: string;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsEnum(RegistrationType)
  type!: RegistrationType;

  @IsOptional()
  @IsString()
  appointmentId?: string;

  @IsOptional()
  @IsString()
  chiefComplaint?: string;
}
