import { IsString, IsOptional, IsNumber, IsDateString } from 'class-validator';

export class CreateEquipmentDto {
  @IsString() name!: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() serialNumber?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsNumber() purchasePrice?: number;
  @IsOptional() @IsDateString() purchaseDate?: string;
  @IsOptional() @IsString() supplier?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() remarks?: string;
}

export class UpdateEquipmentDto extends CreateEquipmentDto {}

export class QueryEquipmentDto {
  @IsOptional() @IsString() keyword?: string;
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() @IsString() status?: string;
  @IsOptional() @IsString() startDate?: string;
  @IsOptional() @IsString() endDate?: string;
}
