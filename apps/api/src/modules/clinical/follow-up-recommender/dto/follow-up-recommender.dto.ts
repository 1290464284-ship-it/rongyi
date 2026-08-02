import { IsString, IsOptional, IsInt, Min, Max, MaxLength, IsBoolean, IsArray, IsNumber } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class VisitRecommendApplyDto {
  @ApiProperty({ description: '负责人ID', example: 'nurse-uuid-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  assigneeId?: string;

  @ApiProperty({ description: '推荐结果列表（通常从 recommend 接口返回）', type: 'array', items: {}, required: false })
  @IsOptional()
  @IsArray()
  recommendations?: unknown[];
}

export class BatchGenerateOptionsDto {
  @ApiProperty({ description: '批量处理的患者上限', example: 200, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2000)
  limit?: number = 200;
}

export class GetNextRemindersQueryDto {
  @ApiProperty({ description: '患者ID（可空，空=全部）', example: 'patient-uuid-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  patientId?: string;

  @ApiProperty({ description: '返回条数上限', example: 50, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 50;

  @ApiProperty({ description: '仅返回逾期的（planDate 早于今天）', example: false, required: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  overdueOnly?: boolean = false;
}

export class FollowUpRecommendResultDto {
  @ApiProperty({ description: '匹配到的复诊模板ID' })
  templateId!: string;

  @ApiProperty({ description: '模板名称' })
  templateName!: string;

  @ApiProperty({ description: '推荐复诊日期（ISO yyyy-MM-dd）', example: '2026-08-31' })
  recommendedDate!: string;

  @ApiProperty({ description: '推荐原因：包含依从性/风险/治疗代码信息' })
  reason!: string;

  @ApiProperty({ description: '置信度 0..1，越高越推荐', example: 0.85 })
  @IsNumber()
  confidence!: number;
}

export class BatchGenerateResultDto {
  @ApiProperty({ description: '遍历的患者数量' })
  totalProcessed!: number;

  @ApiProperty({ description: '成功生成的 FollowUpAssignment 数量' })
  totalGenerated!: number;

  @ApiProperty({ description: '因已存在同类任务被跳过的数量' })
  skippedDueToExisting!: number;
}
