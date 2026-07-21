import { IsString, IsArray, ValidateNested, IsOptional, IsNumber, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class TreatmentPlanItemDto {
  @IsString()
  code!: string;

  @IsString()
  name!: string;

  @IsString()
  category!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsInt()
  @Min(1)
  quantity!: number;

  @IsArray()
  teethNumbers: number[] = [];

  @IsOptional()
  @IsString()
  remark?: string;
}

export class CreateTreatmentPlanDto {
  @IsString()
  patientId!: string;

  @IsOptional()
  @IsString()
  visitId?: string;

  @IsString()
  doctorId!: string;

  @IsString()
  name!: string;

  @IsOptional()
  @IsString()
  remark?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TreatmentPlanItemDto)
  items!: TreatmentPlanItemDto[];
}
