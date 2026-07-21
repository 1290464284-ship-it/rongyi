import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, Min, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateProcessingOrderItemDto {
  @IsOptional() @IsString()
  id?: string;

  @IsOptional() @IsString()
  productId?: string;

  @IsOptional() @IsString()
  productName?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  toothNumber?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional() @IsString()
  remark?: string;
}

export class UpdateProcessingOrderDto {
  @IsOptional() @IsString() factoryId?: string;
  @IsOptional() @IsString() doctorId?: string;
  @IsOptional() @IsString() shade?: string;
  @IsOptional() @IsArray() teethNumbers?: string[];
  @IsOptional() @IsString() expectedAt?: string;
  @IsOptional() @IsString() remark?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProcessingOrderItemDto)
  items?: UpdateProcessingOrderItemDto[];
}

export class UpdateStatusDto {
  @IsString() status!: string;
  @IsOptional() @IsString() remark?: string;
}

export class AddFlowLogDto {
  @IsString() status!: string;
  @IsOptional() @IsString() remark?: string;
}

export class LinkChargeDto {
  @IsString() chargeId!: string;
}
