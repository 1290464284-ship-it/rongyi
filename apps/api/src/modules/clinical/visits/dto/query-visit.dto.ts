import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { VisitStatus } from '@dental/shared';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

export class QueryVisitDto extends PaginationQueryDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiProperty({ description: '就诊状态', enum: VisitStatus, example: VisitStatus.IN_PROGRESS, required: false })
  @IsOptional()
  @IsEnum(VisitStatus)
  status?: VisitStatus;
}
