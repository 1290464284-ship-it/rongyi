import { IsString, IsEnum, IsOptional, IsDateString, MaxLength } from 'class-validator';
import { AppointmentType } from '../../../../common/types/enums';

export class CreateAppointmentDto {
  @IsString()
  patientId!: string;

  @IsString()
  doctorId!: string;

  @IsDateString()
  startTime!: string;

  @IsDateString()
  endTime!: string;

  @IsEnum(AppointmentType)
  type!: AppointmentType;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
