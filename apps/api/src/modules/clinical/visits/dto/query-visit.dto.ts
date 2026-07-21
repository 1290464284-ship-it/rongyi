import { IsOptional, IsString, IsEnum } from 'class-validator';
import { VisitStatus } from '../../../../common/types/enums';
import { BaseQueryDto } from '../../../../common/dto/base-query.dto';

export class QueryVisitDto extends BaseQueryDto {
  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsEnum(VisitStatus)
  status?: VisitStatus;
}
