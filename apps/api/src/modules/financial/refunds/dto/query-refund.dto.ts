import { IsOptional, IsString } from 'class-validator';

export class QueryRefundDto {
  @IsOptional() @IsString() patientId?: string;
  @IsOptional() @IsString() chargeId?: string;
}
