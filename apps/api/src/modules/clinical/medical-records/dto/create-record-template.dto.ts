import { IsString, IsOptional, IsInt, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRecordTemplateDto {
  @ApiProperty({ description: '模板名称', example: '常规初诊模板' })
  @IsString() @MaxLength(100) name!: string;

  @ApiProperty({ description: '模板分类', example: '初诊', required: false })
  @IsOptional() @IsString() @MaxLength(50) category?: string;

  @ApiProperty({ description: '主诉', example: '右上后牙疼痛3天', required: false })
  @IsOptional() @IsString() @MaxLength(2000) chiefComplaint?: string;

  @ApiProperty({ description: '现病史', example: '患者3天前出现右上后牙疼痛...', required: false })
  @IsOptional() @IsString() @MaxLength(5000) presentIllness?: string;

  @ApiProperty({ description: '既往史', example: '体健，否认系统性疾病', required: false })
  @IsOptional() @IsString() @MaxLength(2000) pastHistory?: string;

  @ApiProperty({ description: '检查所见', example: '16远中邻面龋坏，探诊敏感...', required: false })
  @IsOptional() @IsString() @MaxLength(3000) examination?: string;

  @ApiProperty({ description: '诊断', example: '16深龋', required: false })
  @IsOptional() @IsString() @MaxLength(2000) diagnosis?: string;

  @ApiProperty({ description: '治疗计划', example: '16树脂充填治疗', required: false })
  @IsOptional() @IsString() @MaxLength(3000) treatmentPlan?: string;

  @ApiProperty({ description: '是否公开', example: 1, required: false })
  @IsOptional() @IsInt() isPublic?: number;
}
