import { IsOptional, IsString } from 'class-validator';
import { BaseQueryDto } from '../../../../common/dto/base-query.dto';

export class QueryInventoryItemDto extends BaseQueryDto {
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() lowStock?: string;
}
