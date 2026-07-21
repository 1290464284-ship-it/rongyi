import { IsOptional, IsString } from 'class-validator';
import { BaseQueryDto } from '../../../../common/dto/base-query.dto';

export class QueryProcessingOrderDto extends BaseQueryDto {
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() factoryId?: string;
  @IsOptional() @IsString() doctorId?: string;
  @IsOptional() @IsString() patientId?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
  @IsOptional() @IsString() keyword?: string;
}
