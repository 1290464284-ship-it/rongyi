import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

export class QueryInventoryItemDto extends PaginationQueryDto {
  @ApiProperty({ description: '物品分类', example: '耗材', required: false })
  @IsOptional() @IsString() category?: string;

  @ApiProperty({ description: '是否低库存（true/false）', example: 'false', required: false })
  @IsOptional() @IsString() lowStock?: string;
}
