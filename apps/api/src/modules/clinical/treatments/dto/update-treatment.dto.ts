import { PartialType, OmitType } from '@nestjs/mapped-types';
import { IsEnum, IsOptional, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TreatmentStatus } from '@dental/shared';
import { CreateTreatmentDto } from './create-treatment.dto';

export class UpdateTreatmentDto extends OmitType(PartialType(CreateTreatmentDto), [
  'patientId',
  'doctorId',
] as const) {
  @ApiProperty({ description: '治疗项目编码', example: 'TX001', required: false })
  code?: string;

  @ApiProperty({ description: '治疗项目名称', example: '树脂充填', required: false })
  name?: string;

  @ApiProperty({ description: '治疗类别', example: '牙体牙髓', required: false })
  category?: string;

  @ApiProperty({ description: '单价', example: 300, required: false })
  price?: number;

  @ApiProperty({ description: '数量', example: 1, required: false })
  quantity?: number;

  @ApiProperty({ description: '治疗牙位', type: 'array', items: { type: 'number' }, example: [16, 26], required: false })
  teethNumbers?: number[];

  @ApiProperty({ description: '计划治疗日期', example: '2024-01-20', required: false })
  plannedDate?: string;

  @ApiProperty({ description: '备注', example: '去腐后盖髓，树脂充填', required: false })
  remark?: string;

  @ApiProperty({ description: '治疗状态', enum: TreatmentStatus, example: TreatmentStatus.IN_PROGRESS, required: false })
  @IsOptional()
  @IsEnum(TreatmentStatus)
  status?: TreatmentStatus;

  @ApiProperty({ description: '完成日期', example: '2024-01-25', required: false })
  @IsOptional()
  @IsDateString()
  completedDate?: string;
}
