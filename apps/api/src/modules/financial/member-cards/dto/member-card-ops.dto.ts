import { IsNumber, IsString, IsOptional, Min, Max } from 'class-validator';

export class AddPointsDto {
  @IsNumber() @Min(1) @Max(999999)
  points: number;

  @IsOptional() @IsString() chargeId?: string;

  @IsOptional() @IsString() remark?: string;
}

export class DeductPointsDto {
  @IsNumber() @Min(1) @Max(999999)
  points: number;

  @IsOptional() @IsString() remark?: string;
}

export class ConsumeDto {
  @IsNumber() @Min(0.01) @Max(99999999.99)
  amount: number;

  @IsOptional() @IsString() chargeId?: string;

  @IsOptional() @IsString() remark?: string;
}

export class RefundDto {
  @IsNumber() @Min(0.01) @Max(99999999.99)
  amount: number;

  @IsOptional() @IsString() chargeId?: string;

  @IsOptional() @IsString() remark?: string;
}
