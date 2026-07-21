import { IsString, IsOptional, IsArray, IsDateString } from 'class-validator';
import { ToothDiseaseDto } from './tooth-disease.dto';

export class CreateFirstExamDto {
  @IsString() patientId!: string;
  @IsOptional() @IsString() doctorId?: string;
  @IsOptional() @IsString() consultantId?: string;
  @IsOptional() @IsDateString() examDate?: string;
  @IsOptional() @IsString() dentitionType?: string;
  @IsOptional() @IsString() chiefComplaint?: string;
  @IsOptional() @IsArray() teeth?: ToothDiseaseDto[];
}
