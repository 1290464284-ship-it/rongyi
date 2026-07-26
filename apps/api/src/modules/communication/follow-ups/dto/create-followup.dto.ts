import { IsString, IsOptional, IsDateString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateFollowupDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString()
  @MaxLength(100)
  patientId!: string;

  @ApiProperty({ description: '计划随访日期', example: '2024-01-20' })
  @IsDateString()
  planDate!: string;

  @ApiProperty({ description: '随访内容', example: '询问患者术后恢复情况', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @ApiProperty({ description: '负责人ID', example: 'staff-uuid-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  assigneeId?: string;

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

  @ApiProperty({ description: '随访模板ID', example: 'template-uuid-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  templateId?: string;
}
