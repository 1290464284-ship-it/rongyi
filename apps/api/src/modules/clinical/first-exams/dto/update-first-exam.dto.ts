import { IsString, IsOptional, IsArray, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ToothDiseaseDto } from './tooth-disease.dto';

export class UpdateFirstExamDto {
  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) doctorId?: string;

  @ApiProperty({ description: '咨询师ID', example: 'consultant-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) consultantId?: string;

  @ApiProperty({ description: '初诊日期', example: '2024-01-15', required: false })
  @IsOptional() @IsString() @MaxLength(20) examDate?: string;

  @ApiProperty({ description: '牙列类型', example: '恒牙列', required: false })
  @IsOptional() @IsString() @MaxLength(50) dentitionType?: string;

  @ApiProperty({ description: '主诉', example: '右上后牙疼痛', required: false })
  @IsOptional() @IsString() @MaxLength(2000) chiefComplaint?: string;

  @ApiProperty({ description: '初诊状态', example: '已完成', required: false })
  @IsOptional() @IsString() @MaxLength(50) status?: string;

  @ApiProperty({ description: '牙齿检查详情', type: () => [ToothDiseaseDto], required: false })
  @IsOptional() @IsArray() teeth?: ToothDiseaseDto[];
}
