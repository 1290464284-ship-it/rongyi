import { IsOptional, IsString } from 'class-validator';
import { BaseQueryDto } from '../../../common/dto/base-query.dto';

export class QueryPatientDto extends BaseQueryDto {
  @IsOptional()
  @IsString()
  keyword?: string;
}
