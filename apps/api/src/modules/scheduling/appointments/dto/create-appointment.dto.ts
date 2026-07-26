import { IsString, IsEnum, IsOptional, IsDateString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AppointmentType } from '@dental/shared';

export class CreateAppointmentDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString()
  patientId!: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001' })
  @IsString()
  doctorId!: string;

  @ApiProperty({ description: '预约开始时间', example: '2024-01-15T09:00:00.000Z' })
  @IsDateString()
  startTime!: string;

  @ApiProperty({ description: '预约结束时间', example: '2024-01-15T10:00:00.000Z' })
  @IsDateString()
  endTime!: string;

  @ApiProperty({ description: '预约类型', enum: AppointmentType, example: AppointmentType.FIRST_VISIT })
  @IsEnum(AppointmentType)
  type!: AppointmentType;

  @ApiProperty({ description: '备注', example: '患者主诉牙痛', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
