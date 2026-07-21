import { IsString, IsOptional, IsEnum, IsArray, IsDateString, MaxLength } from 'class-validator';

export enum PatientSource {
  WALK_IN = 'WALK_IN',
  REFERRAL = 'REFERRAL',
  ONLINE = 'ONLINE',
  OTHER = 'OTHER',
}

export enum PatientGender {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
}

export class CreatePatientDto {
  @IsOptional() @IsString() @MaxLength(20) code?: string;
  @IsString() @MaxLength(50) name!: string;
  @IsEnum(PatientGender) gender!: PatientGender;
  @IsString() @MaxLength(20) phone!: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() @MaxLength(18) idCard?: string;
  @IsOptional() @IsString() @MaxLength(200) address?: string;
  @IsOptional() @IsString() @MaxLength(50) occupation?: string;
  @IsOptional() @IsString() @MaxLength(2000) remark?: string;
  @IsOptional() @IsString() avatar?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) tags?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) allergies?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) medicalHistory?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) medicationHistory?: string[];
  @IsOptional() @IsArray() @IsString({ each: true }) systemicDiseases?: string[];
  @IsOptional() @IsEnum(PatientSource) source?: PatientSource;
  @IsOptional() @IsString() familyId?: string;
  @IsOptional() @IsString() @MaxLength(50) referrer?: string;
  @IsOptional() @IsString() @MaxLength(50) emergencyContact?: string;
  @IsOptional() @IsString() @MaxLength(20) emergencyPhone?: string;
}
