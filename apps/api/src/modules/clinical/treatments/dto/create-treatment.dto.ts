import {
  IsString,
  IsOptional,
  IsNumber,
  IsInt,
  IsArray,
  IsDateString,
  Min,
  Max,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateTreatmentDto {
  @IsString()
  patientId!: string;

  @IsOptional()
  @IsString()
  visitId?: string;

  @IsString()
  doctorId!: string;

  @IsString()
  @MaxLength(50)
  code!: string;

  @IsString()
  @MaxLength(100)
  name!: string;

  @IsString()
  @MaxLength(50)
  category!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(99999999.99)
  price!: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number = 1;

  @IsOptional()
  @IsArray()
  teethNumbers?: number[];

  @IsOptional()
  @IsDateString()
  plannedDate?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
