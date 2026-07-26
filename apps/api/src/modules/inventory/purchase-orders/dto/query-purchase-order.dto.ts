import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

export class QueryPurchaseOrderDto extends PaginationQueryDto {
  @ApiProperty({ description: '供应商ID', example: 'supplier-uuid-001', required: false })
  @IsOptional() @IsString() supplierId?: string;

  @ApiProperty({ description: '订单状态', example: 'pending', required: false })
  @IsOptional() @IsString() status?: string;
}
