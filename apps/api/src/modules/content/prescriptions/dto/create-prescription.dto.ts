import { IsString, IsNotEmpty, IsArray, ValidateNested, IsOptional, IsInt, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';

export class PrescriptionItemDto {
  @IsOptional()
  @IsString()
  drugCode?: string;

  @IsString()
  drugName!: string;

  @IsString()
  spec!: string;

  @IsString()
  dosage!: string;

  @IsString()
  frequency!: string;

  @IsInt()
  days!: number;

  @IsNumber()
  quantity!: number;

  @IsString()
  unit!: string;
}

export class CreatePrescriptionDto {
  @IsString()
  patientId!: string;

  @IsOptional()
  @IsString()
  visitId?: string;

  @IsString()
  doctorId!: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items!: PrescriptionItemDto[];
}
