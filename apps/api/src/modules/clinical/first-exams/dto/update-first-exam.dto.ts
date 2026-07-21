import { IsString, IsOptional, IsArray } from 'class-validator';
import { ToothDiseaseDto } from './tooth-disease.dto';

export class UpdateFirstExamDto {
  @IsOptional() @IsString() doctorId?: string;
  @IsOptional() @IsString() consultantId?: string;
  @IsOptional() @IsString() examDate?: string;
  @IsOptional() @IsString() dentitionType?: string;
  @IsOptional() @IsString() chiefComplaint?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsArray() teeth?: ToothDiseaseDto[];
}
