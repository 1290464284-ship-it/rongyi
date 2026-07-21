import { IsString, IsOptional, IsInt } from 'class-validator';

export class CreateRecordTemplateDto {
  @IsString() name!: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() chiefComplaint?: string;
  @IsOptional() @IsString() presentIllness?: string;
  @IsOptional() @IsString() pastHistory?: string;
  @IsOptional() @IsString() examination?: string;
  @IsOptional() @IsString() diagnosis?: string;
  @IsOptional() @IsString() treatmentPlan?: string;
  @IsOptional() @IsInt() isPublic?: number;
}
