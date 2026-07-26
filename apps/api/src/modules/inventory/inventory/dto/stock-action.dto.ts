import { IsString, IsOptional, IsNumber, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { StockActionType } from '@dental/shared';

export { StockActionType };

export class StockActionDto {
  @ApiProperty({ description: '库存物品ID', example: 'item-uuid-001' })
  @IsString() itemId!: string;

  @ApiProperty({ description: '操作类型（入库/出库/调整）', enum: StockActionType, example: StockActionType.IN })
  @IsEnum(StockActionType)
  type!: StockActionType;

  @ApiProperty({ description: '数量', example: 50 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number;

  @ApiProperty({ description: '单价（入库时记录成本价）', example: 25.5, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiProperty({ description: '供应商ID', example: 'supplier-uuid-001', required: false })
  @IsOptional() @IsString() supplierId?: string;

  @ApiProperty({ description: '备注', example: '采购入库', required: false })
  @IsOptional() @IsString() remark?: string;

  @ApiProperty({ description: '操作人ID（系统自动注入）', required: false })
  @IsOptional() @IsString() operatorId?: string;

  @ApiProperty({ description: '操作人姓名（系统自动注入）', required: false })
  @IsOptional() @IsString() operatorName?: string;

  @ApiProperty({ description: '请求ID（幂等用）', example: 'stock-20240115-001', required: false })
  @IsOptional() @IsString() requestId?: string;
}
