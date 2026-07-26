import { IsString, IsOptional, IsArray, IsDateString, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ToothDiseaseDto } from './tooth-disease.dto';

export class CreateFirstExamDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString() @MaxLength(100) patientId!: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) doctorId?: string;

  @ApiProperty({ description: '咨询师ID', example: 'consultant-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) consultantId?: string;

  @ApiProperty({ description: '初诊日期', example: '2024-01-15', required: false })
  @IsOptional() @IsDateString() examDate?: string;

  @ApiProperty({ description: '牙列类型', example: '恒牙列', required: false })
  @IsOptional() @IsString() @MaxLength(50) dentitionType?: string;

  @ApiProperty({ description: '主诉', example: '右上后牙疼痛', required: false })
  @IsOptional() @IsString() @MaxLength(2000) chiefComplaint?: string;

  @ApiProperty({ description: '牙齿检查详情', type: () => [ToothDiseaseDto], required: false })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ToothDiseaseDto) teeth?: ToothDiseaseDto[];
}

export class CreateFollowUpDto {
  @ApiProperty({ description: '计划随访日期', example: '2024-01-20', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  planDate?: string;

  @ApiProperty({ description: '随访内容', example: '询问患者术后恢复情况', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @ApiProperty({ description: '负责人ID', example: 'staff-uuid-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  assigneeId?: string;
}
