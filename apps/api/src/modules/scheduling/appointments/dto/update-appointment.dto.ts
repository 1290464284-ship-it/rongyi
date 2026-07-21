import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { AppointmentStatus, AppointmentType } from '../../../../common/types/enums';
import { CreateAppointmentDto } from './create-appointment.dto';

export class UpdateAppointmentDto extends OmitType(PartialType(CreateAppointmentDto), [
  'patientId',
  'doctorId',
] as const) {
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;
}
