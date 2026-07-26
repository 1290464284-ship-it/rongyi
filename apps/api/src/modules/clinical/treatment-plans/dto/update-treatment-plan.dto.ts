import { IsOptional, IsString, IsArray, ValidateNested, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { TreatmentPlanItemDto } from './create-treatment-plan.dto';

export class UpdateTreatmentPlanDto {
  @ApiProperty({ description: '治疗计划名称', example: '全口修复方案', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ description: '备注说明', example: '患者同意此治疗方案', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;

  @ApiProperty({ description: '治疗项目列表', type: () => [TreatmentPlanItemDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TreatmentPlanItemDto)
  items?: TreatmentPlanItemDto[];
}
