import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RegistrationStatus, RegistrationType } from '@dental/shared';
import { CreateRegistrationDto } from './create-registration.dto';

export class UpdateRegistrationDto extends OmitType(PartialType(CreateRegistrationDto), [
  'patientId',
] as const) {
  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  doctorId?: string;

  @ApiProperty({ description: '挂号类型', enum: RegistrationType, example: RegistrationType.FIRST_VISIT, required: false })
  type?: RegistrationType;

  @ApiProperty({ description: '关联预约ID', example: 'appointment-uuid-001', required: false })
  appointmentId?: string;

  @ApiProperty({ description: '主诉', example: '右上后牙疼痛', required: false })
  chiefComplaint?: string;

  @ApiProperty({ description: '挂号状态', enum: RegistrationStatus, example: RegistrationStatus.PENDING, required: false })
  @IsOptional()
  @IsEnum(RegistrationStatus)
  status?: RegistrationStatus;

  @ApiProperty({ description: '分诊备注', example: '安排到1号诊室', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  triageNote?: string;
}
