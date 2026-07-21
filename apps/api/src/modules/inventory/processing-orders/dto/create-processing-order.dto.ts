import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, Min, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class ProcessingOrderItemDto {
  @IsOptional() @IsString()
  productId?: string;

  @IsString()
  productName!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  toothNumber?: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @IsOptional() @IsString()
  remark?: string;
}

export class CreateProcessingOrderDto {
  @IsString() patientId!: string;
  @IsOptional() @IsString() visitId?: string;
  @IsString() factoryId!: string;
  @IsOptional() @IsString() doctorId?: string;
  @IsOptional() @IsString() shade?: string;
  @IsOptional() @IsArray() teethNumbers?: string[];
  @IsOptional() @IsString() expectedAt?: string;
  @IsOptional() @IsString() remark?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessingOrderItemDto)
  items!: ProcessingOrderItemDto[];
}
