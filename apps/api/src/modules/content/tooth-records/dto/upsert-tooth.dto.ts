import {
  IsString,
  IsEnum,
  IsOptional,
  IsInt,
  Min,
  Max,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ToothStatus, ToothCondition } from '../../../../common/types/enums';

export class UpsertToothDto {
  @IsString()
  patientId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(11)
  @Max(85)
  toothNumber!: number;

  @IsOptional()
  @IsEnum(ToothStatus)
  currentStatus?: ToothStatus;

  @IsOptional()
  @IsArray()
  @IsEnum(ToothCondition, { each: true })
  conditions?: ToothCondition[];

  @IsOptional()
  @IsString()
  remark?: string;
}
