import { IsString, IsInt, Min, Max, IsOptional, IsIn, IsArray } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

const SOURCES = ['CLINIC', 'QR_CODE', 'SMS_LINK', 'FOLLOW_UP_CALL'] as const;
export type SurveySource = typeof SOURCES[number];

export class SubmitSurveyDto {
  @ApiProperty({ description: '就诊ID（可选，若提供需唯一）', required: false })
  @IsOptional()
  @IsString()
  visitId?: string;

  @ApiProperty({ description: '预约ID（可选）', required: false })
  @IsOptional()
  @IsString()
  appointmentId?: string;

  @ApiProperty({ description: '患者ID', required: true })
  @IsString()
  patientId!: string;

  @ApiProperty({ description: '医生ID（可选）', required: false })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiProperty({ description: 'NPS 评分 0-10', example: 9, required: true, minimum: 0, maximum: 10 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(10)
  npsScore!: number;

  @ApiProperty({ description: '医疗质量评分 1-5', example: 5, required: false, minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  ratingMedical?: number;

  @ApiProperty({ description: '服务态度评分 1-5', example: 5, required: false, minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  ratingService?: number;

  @ApiProperty({ description: '环境评分 1-5', example: 5, required: false, minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  ratingEnvironment?: number;

  @ApiProperty({ description: '价格评分 1-5', example: 5, required: false, minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  ratingPrice?: number;

  @ApiProperty({ description: '等候时间评分 1-5', example: 4, required: false, minimum: 1, maximum: 5 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5)
  ratingWait?: number;

  @ApiProperty({ description: '文字评价（可选）', required: false })
  @IsOptional()
  @IsString()
  comment?: string;

  @ApiProperty({ description: '用户标签数组（可选，与自动标签合并去重）', required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @Type(() => String)
  tags?: string[];

  @ApiProperty({ description: '来源渠道', enum: SOURCES, required: false, default: 'CLINIC' })
  @IsOptional()
  @IsString()
  @IsIn(SOURCES)
  source?: SurveySource;
}
