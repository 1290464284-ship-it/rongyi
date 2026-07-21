import { IsOptional, IsString, IsEnum, IsDateString } from 'class-validator';
import { RegistrationStatus, RegistrationType } from '../../../../common/types/enums';
import { BaseQueryDto } from '../../../../common/dto/base-query.dto';

export class QueryRegistrationDto extends BaseQueryDto {
  @IsOptional()
  @IsString()
  patientId?: string;

  @IsOptional()
  @IsString()
  doctorId?: string;

  @IsOptional()
  @IsEnum(RegistrationStatus)
  status?: RegistrationStatus;

  @IsOptional()
  @IsEnum(RegistrationType)
  type?: RegistrationType;

  @IsOptional()
  @IsDateString()
  startDate?: string;

  @IsOptional()
  @IsDateString()
  endDate?: string;
}
