import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, IsInt, Min, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';

export class ChargeComboItemDto {
  @IsString()
  @IsOptional()
  treatmentCatalogId?: string;

  @IsString()
  itemName!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateComboDto {
  @IsString()
  name!: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChargeComboItemDto)
  items!: ChargeComboItemDto[];
}

export class UpdateComboDto {
  @IsString()
  @IsOptional()
  name?: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsBoolean()
  @IsOptional()
  isPublic?: boolean;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ChargeComboItemDto)
  @IsOptional()
  items?: ChargeComboItemDto[];
}
