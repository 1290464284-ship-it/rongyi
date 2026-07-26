import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { RegistrationStatus, RegistrationType } from '@dental/shared';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

export class QueryRegistrationDto extends PaginationQueryDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiProperty({ description: '挂号状态', enum: RegistrationStatus, example: RegistrationStatus.PENDING, required: false })
  @IsOptional()
  @IsEnum(RegistrationStatus)
  status?: RegistrationStatus;

  @ApiProperty({ description: '挂号类型', enum: RegistrationType, example: RegistrationType.FIRST_VISIT, required: false })
  @IsOptional()
  @IsEnum(RegistrationType)
  type?: RegistrationType;

  @ApiProperty({ description: '开始日期', example: '2024-01-01', required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ description: '结束日期', example: '2024-01-31', required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
