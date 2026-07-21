import { IsString, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateInventoryItemDto {
  @IsString() code!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() spec?: string;
  @IsString() category!: string;
  @IsString() unit!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stock?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minStock?: number = 0;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number = 0;

  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() expireDate?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() remark?: string;
}
