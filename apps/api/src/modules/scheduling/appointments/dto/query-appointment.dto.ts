import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { AppointmentStatus } from '../../../../common/types/enums';
import { BaseQueryDto } from '../../../../common/dto/base-query.dto';

export class QueryAppointmentDto extends BaseQueryDto {
  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsEnum(AppointmentStatus)
  status?: AppointmentStatus;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
