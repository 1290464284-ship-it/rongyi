import { IsOptional, IsString } from 'class-validator';
import { BaseQueryDto } from '../../../../common/dto/base-query.dto';

export class QueryMedicalRecordDto extends BaseQueryDto {
  @IsOptional() @IsString() patientId?: string;
  @IsOptional() @IsString() doctorId?: string;
  @IsOptional() @IsString() visitId?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
}
