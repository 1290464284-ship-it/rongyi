import { IsString, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RegistrationType } from '@dental/shared';

export class CreateRegistrationDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString()
  @MaxLength(100)
  patientId!: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  doctorId?: string;

  @ApiProperty({ description: '挂号类型', enum: RegistrationType, example: RegistrationType.FIRST_VISIT })
  @IsEnum(RegistrationType)
  type!: RegistrationType;

  @ApiProperty({ description: '关联预约ID', example: 'appointment-uuid-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  appointmentId?: string;

  @ApiProperty({ description: '主诉', example: '右上后牙疼痛', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  chiefComplaint?: string;
}
