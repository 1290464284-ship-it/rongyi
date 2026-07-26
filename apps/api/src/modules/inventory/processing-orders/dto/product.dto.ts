import { IsString, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateProductDto {
  @ApiProperty({ description: '加工厂ID', example: 'factory-uuid-001' })
  @IsString() factoryId!: string;

  @ApiProperty({ description: '产品名称', example: '二氧化锆全瓷冠' })
  @IsString() name!: string;

  @ApiProperty({ description: '产品分类', example: '固定修复', required: false })
  @IsOptional() @IsString() category?: string;

  @ApiProperty({ description: '产品价格', example: 1500 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiProperty({ description: '备注', example: '常用材料', required: false })
  @IsOptional() @IsString() remark?: string;
}

export class UpdateProductDto {
  @ApiProperty({ description: '产品名称', example: '二氧化锆全瓷冠', required: false })
  @IsOptional() @IsString() name?: string;

  @ApiProperty({ description: '产品分类', example: '固定修复', required: false })
  @IsOptional() @IsString() category?: string;

  @ApiProperty({ description: '产品价格', example: 1500, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;

  @ApiProperty({ description: '备注', example: '常用材料', required: false })
  @IsOptional() @IsString() remark?: string;
}
