import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, IsInt, Min, IsBoolean, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ChargeComboItemDto {
  @ApiProperty({ description: '治疗项目ID', example: 'catalog-uuid-001', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  treatmentCatalogId?: string;

  @ApiProperty({ description: '项目名称', example: '树脂充填' })
  @IsString()
  @MaxLength(100)
  itemName!: string;

  @ApiProperty({ description: '单价', example: 300 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiProperty({ description: '数量', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateComboDto {
  @ApiProperty({ description: '套餐名称', example: '儿童洁牙套餐' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: '套餐分类', example: '儿童牙科', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  category?: string;

  @ApiProperty({ description: '是否公开', example: true, required: false })
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @ApiProperty({ description: '套餐项目列表', type: () => [ChargeComboItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChargeComboItemDto)
  items!: ChargeComboItemDto[];
}

export class UpdateComboDto {
  @ApiProperty({ description: '套餐名称', example: '儿童洁牙套餐', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ description: '套餐分类', example: '儿童牙科', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  category?: string;

  @ApiProperty({ description: '是否公开', example: true, required: false })
  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @ApiProperty({ description: '套餐项目列表', type: () => [ChargeComboItemDto], required: false })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChargeComboItemDto)
  @IsOptional()
  items?: ChargeComboItemDto[];
}
