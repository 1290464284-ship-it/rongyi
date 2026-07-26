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
import { ApiProperty } from '@nestjs/swagger';
import { ToothStatus, ToothCondition } from '@dental/shared';

export class UpsertToothDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString()
  patientId!: string;

  @ApiProperty({ description: '牙位编号', example: 16 })
  @Type(() => Number)
  @IsInt()
  @Min(11)
  @Max(85)
  toothNumber!: number;

  @ApiProperty({ description: '牙齿当前状态', enum: ToothStatus, example: ToothStatus.SOUND, required: false })
  @IsOptional()
  @IsEnum(ToothStatus)
  currentStatus?: ToothStatus;

  @ApiProperty({ description: '牙齿情况列表', type: 'array', items: { type: 'string' }, example: [ToothCondition.DECAY, ToothCondition.FILLING], required: false })
  @IsOptional()
  @IsArray()
  @IsEnum(ToothCondition, { each: true })
  conditions?: ToothCondition[];

  @ApiProperty({ description: '备注', example: '患者自述偶有酸痛', required: false })
  @IsOptional()
  @IsString()
  remark?: string;
}
