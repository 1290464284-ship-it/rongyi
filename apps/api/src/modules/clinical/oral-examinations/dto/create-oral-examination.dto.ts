import { IsString, IsOptional, IsArray, IsDateString } from 'class-validator';

export class CreateOralExaminationDto {
  @IsString() patientId!: string;
  @IsOptional() @IsString() visitId?: string;
  @IsOptional() @IsString() doctorId?: string;
  @IsDateString() examDate!: string;
  @IsOptional() @IsString() plaqueIndex?: string;
  @IsOptional() @IsString() calculusIndex?: string;
  @IsOptional() @IsString() bleedingIndex?: string;
  @IsOptional() @IsArray() caries?: any[];
  @IsOptional() @IsArray() looseTeeth?: any[];
  @IsOptional() @IsArray() percussionPain?: any[];
  @IsOptional() @IsArray() pulpVitality?: any[];
  @IsOptional() @IsString() mucosa?: string;
  @IsOptional() @IsString() tmj?: string;
  @IsOptional() @IsString() remark?: string;
}
