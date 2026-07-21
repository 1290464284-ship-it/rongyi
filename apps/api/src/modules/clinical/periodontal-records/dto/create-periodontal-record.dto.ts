import { IsString, IsOptional, IsDateString, IsObject } from 'class-validator';

export class CreatePeriodontalRecordDto {
  @IsString() patientId!: string;
  @IsOptional() @IsString() visitId?: string;
  @IsOptional() @IsString() doctorId?: string;
  @IsDateString() examDate!: string;
  @IsObject() data!: Record<string, any>;
  @IsOptional() @IsString() remark?: string;
}
