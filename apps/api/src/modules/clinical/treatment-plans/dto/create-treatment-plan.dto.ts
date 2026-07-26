import { IsString, IsArray, ValidateNested, IsOptional, IsNumber, IsInt, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class TreatmentPlanItemDto {
  @ApiProperty({ description: '治疗项目编码', example: 'TX001' })
  @IsString()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ description: '治疗项目名称', example: '根管治疗' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: '治疗类别', example: '牙体牙髓' })
  @IsString()
  @MaxLength(50)
  category!: string;

  @ApiProperty({ description: '单价', example: 1500 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @ApiProperty({ description: '数量', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: '治疗牙位', type: 'array', items: { type: 'number' }, example: [16] })
  @IsArray()
  teethNumbers: number[] = [];

  @ApiProperty({ description: '备注', example: '需分三次治疗', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export class CreateTreatmentPlanDto {
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

  @ApiProperty({ description: '治疗计划名称', example: '全口修复方案' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: '备注说明', example: '患者同意此治疗方案', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;

  @ApiProperty({ description: '治疗项目列表', type: () => [TreatmentPlanItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TreatmentPlanItemDto)
  items!: TreatmentPlanItemDto[];
}
