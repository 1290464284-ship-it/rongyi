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
import { ApiProperty } from '@nestjs/swagger';

export class CreateTreatmentDto {
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

  @ApiProperty({ description: '治疗项目编码', example: 'TX001' })
  @IsString()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ description: '治疗项目名称', example: '树脂充填' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: '治疗类别', example: '牙体牙髓' })
  @IsString()
  @MaxLength(50)
  category!: string;

  @ApiProperty({ description: '单价', example: 300 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(99999999.99)
  price!: number;

  @ApiProperty({ description: '数量', example: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number = 1;

  @ApiProperty({ description: '治疗牙位', type: 'array', items: { type: 'number' }, example: [16, 26], required: false })
  @IsOptional()
  @IsArray()
  teethNumbers?: number[];

  @ApiProperty({ description: '计划治疗日期', example: '2024-01-20', required: false })
  @IsOptional()
  @IsDateString()
  plannedDate?: string;

  @ApiProperty({ description: '备注', example: '去腐后盖髓，树脂充填', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export class CreateTreatmentCatalogDto {
  @ApiProperty({ description: '治疗项目编码', example: 'TX001' })
  @IsString()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ description: '治疗项目名称', example: '树脂充填' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: '治疗类别', example: '牙体牙髓' })
  @IsString()
  @MaxLength(50)
  category!: string;

  @ApiProperty({ description: '单价', example: 300 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(99999999.99)
  price!: number;

  @ApiProperty({ description: '备注', example: '常用治疗项目', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export class UpdateTreatmentCatalogDto {
  @ApiProperty({ description: '治疗项目名称', example: '树脂充填', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ description: '治疗类别', example: '牙体牙髓', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiProperty({ description: '单价', example: 300, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(99999999.99)
  price?: number;

  @ApiProperty({ description: '备注', example: '常用治疗项目', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
