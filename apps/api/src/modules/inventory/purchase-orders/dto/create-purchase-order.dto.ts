import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class PurchaseOrderItemDto {
  @ApiProperty({ description: '库存物品ID', example: 'item-uuid-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  itemId?: string;

  @ApiProperty({ description: '物品名称', example: '一次性医用口罩' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: '规格型号', example: '50只/盒', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  spec?: string;

  @ApiProperty({ description: '数量', example: 10 })
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: '单价', example: 25.5 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;
}

export class CreatePurchaseOrderDto {
  @ApiProperty({ description: '供应商ID', example: 'supplier-uuid-001' })
  @IsString()
  @MaxLength(100)
  supplierId!: string;

  @ApiProperty({ description: '备注', example: '紧急采购', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;

  @ApiProperty({ description: '采购物品列表', type: () => [PurchaseOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items!: PurchaseOrderItemDto[];
}
