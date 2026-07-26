import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AppointmentStatus, AppointmentType } from '@dental/shared';
import { CreateAppointmentDto } from './create-appointment.dto';

export class UpdateAppointmentDto extends OmitType(PartialType(CreateAppointmentDto), [
  'patientId',
  'doctorId',
] as const) {
  @ApiProperty({ description: '预约状态', enum: AppointmentStatus, example: AppointmentStatus.BOOKED, required: false })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiProperty({ description: '预约类型', enum: AppointmentType, example: AppointmentType.RETURN, required: false })
  @IsOptional()
  @IsEnum(AppointmentType)
  type?: AppointmentType;
}
