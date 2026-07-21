import { IsString, IsOptional, IsNumber, IsArray, Min, ValidateNested, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class ChargeItemDto {
  @IsString() name: string;

  @IsOptional() @IsString() category?: string;

  @IsOptional() @IsNumber() @Min(0) price?: number;

  @IsOptional() @IsInt() @Min(1) quantity?: number;

  @IsOptional() @IsArray() @IsString({ each: true }) teethNumbers?: string[];
}

export class CreateChargeDto {
  @IsString() patientId: string;

  @IsOptional() @IsString() doctorId?: string;

  @IsOptional() @IsString() remark?: string;

  @IsArray() @ValidateNested({ each: true }) @Type(() => ChargeItemDto)
  items: ChargeItemDto[];
}
