import { IsString, IsOptional, IsEnum, IsArray, IsDateString, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Gender, PatientSource } from '@dental/shared';

export const PatientGender = Gender;
export type PatientGenderType = Gender;

export { PatientSource };

export class CreatePatientDto {
  @ApiProperty({ description: '患者编号', example: 'P001', required: false })
  @IsOptional() @IsString() @MaxLength(20) code?: string;

  @ApiProperty({ description: '患者姓名', example: '张三' })
  @IsString() @MaxLength(50) name!: string;

  @ApiProperty({ description: '性别', enum: Gender, example: Gender.MALE })
  @IsEnum(PatientGender) gender!: PatientGenderType;

  @ApiProperty({ description: '手机号码', example: '13800138000' })
  @IsString() @MaxLength(20) @Matches(/^1[3-9]\d{9}$/, { message: '请输入有效的手机号码' }) phone!: string;

  @ApiProperty({ description: '出生日期', example: '1990-01-01', required: false })
  @IsOptional() @IsDateString() birthDate?: string;

  @ApiProperty({ description: '身份证号', example: '110101199001011234', required: false })
  @IsOptional() @IsString() @MaxLength(18) idCard?: string;

  @ApiProperty({ description: '地址', example: '北京市朝阳区xx街道', required: false })
  @IsOptional() @IsString() @MaxLength(200) address?: string;

  @ApiProperty({ description: '职业', example: '工程师', required: false })
  @IsOptional() @IsString() @MaxLength(50) occupation?: string;

  @ApiProperty({ description: '备注', example: '患者对青霉素过敏', required: false })
  @IsOptional() @IsString() @MaxLength(2000) remark?: string;

  @ApiProperty({ description: '头像URL', required: false })
  @IsOptional() @IsString() @MaxLength(500) avatar?: string;

  @ApiProperty({ description: '标签', type: 'array', items: { type: 'string' }, example: ['VIP', '老患者'], required: false })
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];

  @ApiProperty({ description: '过敏史', type: 'array', items: { type: 'string' }, example: ['青霉素', '花粉'], required: false })
  @IsOptional() @IsArray() @IsString({ each: true }) allergies?: string[];

  @ApiProperty({ description: '既往病史', type: 'array', items: { type: 'string' }, example: ['高血压', '糖尿病'], required: false })
  @IsOptional() @IsArray() @IsString({ each: true }) medicalHistory?: string[];

  @ApiProperty({ description: '用药史', type: 'array', items: { type: 'string' }, example: ['阿司匹林'], required: false })
  @IsOptional() @IsArray() @IsString({ each: true }) medicationHistory?: string[];

  @ApiProperty({ description: '系统性疾病', type: 'array', items: { type: 'string' }, example: ['心脏病'], required: false })
  @IsOptional() @IsArray() @IsString({ each: true }) systemicDiseases?: string[];

  @ApiProperty({ description: '患者来源', enum: PatientSource, example: PatientSource.WALK_IN, required: false })
  @IsOptional() @IsEnum(PatientSource) source?: PatientSource;

  @ApiProperty({ description: '家庭ID', required: false })
  @IsOptional() @IsString() @MaxLength(100) familyId?: string;

  @ApiProperty({ description: '推荐人', required: false })
  @IsOptional() @IsString() @MaxLength(50) referrer?: string;

  @ApiProperty({ description: '紧急联系人', required: false })
  @IsOptional() @IsString() @MaxLength(50) emergencyContact?: string;

  @ApiProperty({ description: '紧急联系电话', required: false })
  @IsOptional() @IsString() @MaxLength(20) emergencyPhone?: string;
}
