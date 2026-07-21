import { IsNumber, IsString, IsOptional, Min, Max, MaxLength } from 'class-validator';

export class RechargeDto {
  @IsNumber() @Min(0.01) @Max(99999999.99) amount!: number;
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
}
