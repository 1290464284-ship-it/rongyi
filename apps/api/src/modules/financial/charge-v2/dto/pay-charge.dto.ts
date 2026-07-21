import { IsNumber, IsString, IsOptional, Min, Max } from 'class-validator';

export class PayChargeDto {
  @IsNumber()
  @Min(0.01)
  @Max(99999999.99)
  amount!: number;

  @IsOptional()
  @IsString()
  payMethod?: string;

  @IsOptional()
  @IsString()
  requestId?: string;
}
