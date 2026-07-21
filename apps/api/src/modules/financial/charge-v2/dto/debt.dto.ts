import { IsString, IsOptional, IsEnum, IsInt, Min, IsNumber, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export enum DebtStatus {
  UNPAID = 'UNPAID',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
}

export class QueryDebtDto {
  @IsString()
  @IsOptional()
  patientId?: string;

  @IsEnum(DebtStatus)
  @IsOptional()
  status?: DebtStatus;

  @IsString()
  @IsOptional()
  startDate?: string;

  @IsString()
  @IsOptional()
  endDate?: string;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page = 1;

  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  pageSize = 20;
}

export class CreateDebtFromChargeDto {
  @IsString()
  chargeId!: string;

  @IsString()
  patientId!: string;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  totalAmount!: number;

  @IsNumber()
  @Type(() => Number)
  @Min(0)
  debtAmount!: number;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string;
}

export class PayDebtDto {
  @IsNumber()
  @Min(0.01)
  @Max(99999999.99)
  @Type(() => Number)
  amount!: number;

  @IsString()
  @IsOptional()
  payMethod?: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string;
}
