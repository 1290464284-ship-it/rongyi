import { IsOptional, IsString } from 'class-validator';
import { BaseQueryDto } from '../../../../common/dto/base-query.dto';

export class QueryPrescriptionDto extends BaseQueryDto {
  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  doctorId?: string;
}
