import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

export class QueryMedicalRecordDto extends PaginationQueryDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  @IsOptional() @IsString() patientId?: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional() @IsString() doctorId?: string;

  @ApiProperty({ description: '就诊ID', example: 'visit-uuid-001', required: false })
  @IsOptional() @IsString() visitId?: string;

  @ApiProperty({ description: '开始日期', example: '2024-01-01', required: false })
  @IsOptional() @IsString() startDate?: string;

  @ApiProperty({ description: '结束日期', example: '2024-01-31', required: false })
  @IsOptional() @IsString() endDate?: string;
}
