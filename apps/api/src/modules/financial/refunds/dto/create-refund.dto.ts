import { IsString, IsNumber, IsOptional, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateRefundDto {
  @IsString() chargeId!: string;
  @IsString() patientId!: string;
  @IsNumber() @Type(() => Number) @Min(0.01) @Max(99999999.99) amount!: number;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() requestId?: string;
}
