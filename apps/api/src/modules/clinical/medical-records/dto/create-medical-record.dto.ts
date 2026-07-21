import { IsString, IsOptional, IsArray, IsInt, MaxLength } from 'class-validator';

export class CreateMedicalRecordDto {
  @IsString() patientId!: string;
  @IsOptional() @IsString() visitId?: string;
  @IsString() doctorId!: string;
  @IsOptional() @IsString() templateId?: string;
  @IsOptional() @IsString() @MaxLength(2000) chiefComplaint?: string;
  @IsOptional() @IsString() @MaxLength(5000) presentIllness?: string;
  @IsOptional() @IsString() @MaxLength(2000) pastHistory?: string;
  @IsOptional() @IsString() @MaxLength(1000) allergyHistory?: string;
  @IsOptional() @IsString() @MaxLength(3000) examination?: string;
  @IsOptional() @IsString() @MaxLength(2000) diagnosis?: string;
  @IsOptional() @IsString() @MaxLength(3000) treatmentPlan?: string;
  @IsOptional() @IsArray() teethInvolved?: string[];
  @IsOptional() @IsArray() images?: string[];
  @IsOptional() @IsString() signature?: string;
  @IsOptional() @IsInt() isLocked?: number;
}
