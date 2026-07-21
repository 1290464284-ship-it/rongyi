import { IsString, IsOptional } from 'class-validator';

export class CreateSupplierDto {
  @IsString() name!: string;
  @IsOptional() @IsString() contactPerson?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsString() bankAccount?: string;
  @IsOptional() @IsString() remark?: string;
}
