import { IsOptional, IsString } from 'class-validator';

export class QueryPeriodontalRecordDto {
  @IsOptional() @IsString() patientId?: string;
  @IsOptional() @IsString() visitId?: string;
}
