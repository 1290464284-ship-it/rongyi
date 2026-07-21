import { IsOptional, IsString } from 'class-validator';
import { BaseQueryDto } from '../../../../common/dto/base-query.dto';

export class QueryPurchaseOrderDto extends BaseQueryDto {
  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() status?: string;
}
