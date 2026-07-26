import { IsString, IsOptional, IsDateString, IsInt, Min, Max, MaxLength, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

const FOLLOWUP_STATUSES = ['PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_ANSWER'];

export class UpdateFollowupDto {
  @ApiProperty({ description: '计划随访日期', example: '2024-01-20', required: false })
  @IsOptional()
  @IsDateString()
  planDate?: string;

  @ApiProperty({ description: '随访内容', example: '询问患者术后恢复情况', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @ApiProperty({ description: '随访状态', enum: FOLLOWUP_STATUSES, example: 'COMPLETED', required: false })
  @IsOptional()
  @IsString()
  @IsIn(FOLLOWUP_STATUSES)
  status?: string;

  @ApiProperty({ description: '随访结果', example: '患者恢复良好，无不适', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  result?: string;

  @ApiProperty({ description: '负责人ID', example: 'staff-uuid-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  assigneeId?: string;

  @ApiProperty({ description: '完成时间', example: '2024-01-20T10:00:00.000Z', required: false })
  @IsOptional()
  @IsDateString()
  completedAt?: string;

  @ApiProperty({ description: '随访类型', example: '电话随访', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  type?: string;

  @ApiProperty({ description: '关联项目ID', example: 'treatment-uuid-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  itemId?: string;

  @ApiProperty({ description: '结果记录ID', example: 'result-uuid-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  resultId?: string;

  @ApiProperty({ description: '患者满意度（0-10分）', example: 9, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  patientSatisfaction?: number;

  @ApiProperty({ description: '疼痛程度（0-10分）', example: 2, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  painLevel?: number;

  @ApiProperty({ description: 'NPS推荐值（0-10分）', example: 9, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  npsScore?: number;
}
