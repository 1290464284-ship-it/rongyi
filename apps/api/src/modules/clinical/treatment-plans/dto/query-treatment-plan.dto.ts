import { IsOptional, IsString, IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PlanStatus } from '@dental/shared';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

export class QueryTreatmentPlanDto extends PaginationQueryDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiProperty({ description: '计划状态', enum: PlanStatus, example: PlanStatus.DRAFT, required: false })
  @IsOptional()
  @IsEnum(PlanStatus)
  status?: PlanStatus;
}
