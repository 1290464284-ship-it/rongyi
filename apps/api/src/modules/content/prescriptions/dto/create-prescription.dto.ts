import { IsString, IsArray, ValidateNested, IsOptional, IsInt, IsNumber, MaxLength, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class PrescriptionItemDto {
  @ApiProperty({ description: '药品编码', example: 'DRUG001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  drugCode?: string;

  @ApiProperty({ description: '药品名称', example: '阿莫西林胶囊' })
  @IsString()
  @MaxLength(100)
  drugName!: string;

  @ApiProperty({ description: '规格', example: '0.25g*24粒' })
  @IsString()
  @MaxLength(100)
  spec!: string;

  @ApiProperty({ description: '用法用量', example: '口服，一次0.5g' })
  @IsString()
  @MaxLength(100)
  dosage!: string;

  @ApiProperty({ description: '服用频次', example: '每日3次' })
  @IsString()
  @MaxLength(50)
  frequency!: string;

  @ApiProperty({ description: '用药天数', example: 7 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days!: number;

  @ApiProperty({ description: '数量', example: 2 })
  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  quantity!: number;

  @ApiProperty({ description: '单位', example: '盒' })
  @IsString()
  @MaxLength(20)
  unit!: string;
}

export class CreatePrescriptionDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString()
  @MaxLength(100)
  patientId!: string;

  @ApiProperty({ description: '就诊记录ID', example: 'visit-uuid-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  visitId?: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001' })
  @IsString()
  @MaxLength(100)
  doctorId!: string;

  @ApiProperty({ description: '处方备注', example: '饭后服用，忌酒', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;

  @ApiProperty({ description: '处方药品列表', type: () => [PrescriptionItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PrescriptionItemDto)
  items!: PrescriptionItemDto[];
}
