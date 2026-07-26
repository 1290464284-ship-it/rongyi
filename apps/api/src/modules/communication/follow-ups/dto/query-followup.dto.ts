import { IsOptional, IsString, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

export class QueryFollowupDto extends PaginationQueryDto {
  @ApiProperty({ description: '随访状态', example: 'pending', required: false })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiProperty({ description: '负责人ID', example: 'staff-uuid-001', required: false })
  @IsOptional()
  @IsString()
  assigneeId?: string;

  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiProperty({ description: '随访类型', example: 'post_treatment', required: false })
  @IsOptional()
  @IsString()
  type?: string;

  @ApiProperty({ description: '关联项目ID', example: 'treatment-uuid-001', required: false })
  @IsOptional()
  @IsString()
  itemId?: string;

  @ApiProperty({ description: '开始日期', example: '2024-01-01', required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ description: '结束日期', example: '2024-01-31', required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
