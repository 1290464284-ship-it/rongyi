import { IsString, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateInventoryItemDto {
  @ApiProperty({ description: '物品编码', example: 'ITEM001' })
  @IsString() code!: string;

  @ApiProperty({ description: '物品名称', example: '一次性医用口罩' })
  @IsString() name!: string;

  @ApiProperty({ description: '规格型号', example: '50只/盒', required: false })
  @IsOptional() @IsString() spec?: string;

  @ApiProperty({ description: '物品分类', example: '耗材' })
  @IsString() category!: string;

  @ApiProperty({ description: '计量单位', example: '盒' })
  @IsString() unit!: string;

  @ApiProperty({ description: '初始库存', example: 100, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stock?: number = 0;

  @ApiProperty({ description: '最低库存预警', example: 10, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minStock?: number = 0;

  @ApiProperty({ description: '单价', example: 25.5, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number = 0;

  @ApiProperty({ description: '供应商ID', example: 'supplier-uuid-001', required: false })
  @IsOptional() @IsString() supplierId?: string;

  @ApiProperty({ description: '有效期', example: '2025-12-31', required: false })
  @IsOptional() @IsString() expireDate?: string;

  @ApiProperty({ description: '存放位置', example: 'A区-01货架', required: false })
  @IsOptional() @IsString() location?: string;

  @ApiProperty({ description: '备注', required: false })
  @IsOptional() @IsString() remark?: string;
}
