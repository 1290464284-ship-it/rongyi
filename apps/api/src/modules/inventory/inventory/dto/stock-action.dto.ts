import { IsString, IsOptional, IsNumber, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum StockActionType {
  IN = 'IN',
  OUT = 'OUT',
  ADJUST = 'ADJUST',
}

export class StockActionDto {
  @IsString() itemId!: string;

  @IsEnum(StockActionType)
  type!: StockActionType;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  quantity!: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @IsOptional() @IsString() supplierId?: string;
  @IsOptional() @IsString() remark?: string;

  // Injected from req.user (optional in DTO)
  @IsOptional() @IsString() operatorId?: string;
  @IsOptional() @IsString() operatorName?: string;
}
