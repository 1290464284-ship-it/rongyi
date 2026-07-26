import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { AppointmentStatus } from '@dental/shared';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

export class QueryAppointmentDto extends PaginationQueryDto {
  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiProperty({ description: '预约状态', enum: AppointmentStatus, example: AppointmentStatus.BOOKED, required: false })
  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @ApiProperty({ description: '开始日期', example: '2024-01-01', required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ description: '结束日期', example: '2024-01-31', required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;
}
