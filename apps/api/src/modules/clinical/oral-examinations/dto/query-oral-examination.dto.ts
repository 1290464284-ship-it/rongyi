import { IsOptional, IsString } from 'class-validator';

export class QueryOralExaminationDto {
  @IsOptional() @IsString() patientId?: string;
  @IsOptional() @IsString() visitId?: string;
}
