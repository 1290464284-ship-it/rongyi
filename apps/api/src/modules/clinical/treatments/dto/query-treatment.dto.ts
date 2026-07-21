import { IsOptional, IsString, IsEnum, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { TreatmentStatus } from '../../../../common/types/enums';
import { BaseQueryDto } from '../../../../common/dto/base-query.dto';

export class QueryTreatmentDto extends BaseQueryDto {
  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  visitId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  toothNumber?: number;

  @IsOptional()
  @IsEnum(TreatmentStatus)
  status?: TreatmentStatus;
}
