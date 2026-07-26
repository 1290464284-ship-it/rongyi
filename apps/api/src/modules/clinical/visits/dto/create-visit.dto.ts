import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateVisitDto {
  @ApiProperty({ description: '关联预约ID', example: 'appointment-uuid-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  appointmentId?: string;

  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString()
  @MaxLength(100)
  patientId!: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001' })
  @IsString()
  @MaxLength(100)
  doctorId!: string;

  @ApiProperty({ description: '主诉', example: '右上后牙疼痛3天', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  chiefComplaint?: string;

  @ApiProperty({ description: '诊断', example: '16深龋伴牙髓炎', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  diagnosis?: string;

  @ApiProperty({ description: '治疗计划', example: '16根管治疗后全冠修复', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(3000)
  treatmentPlan?: string;
}
