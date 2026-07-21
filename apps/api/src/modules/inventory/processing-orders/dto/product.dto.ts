import { IsString, IsOptional, IsNumber, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateProductDto {
  @IsString() factoryId!: string;
  @IsString() name!: string;
  @IsOptional() @IsString() category?: string;
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;
  @IsOptional() @IsString() remark?: string;
}

export class UpdateProductDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price?: number;
  @IsOptional() @IsString() remark?: string;
}
