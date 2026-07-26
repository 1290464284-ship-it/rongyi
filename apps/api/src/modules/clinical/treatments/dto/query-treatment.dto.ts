import { IsOptional, IsString, IsEnum, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { TreatmentStatus } from '@dental/shared';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

export class QueryTreatmentDto extends PaginationQueryDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiProperty({ description: '就诊ID', example: 'visit-uuid-001', required: false })
  @IsOptional()
  @IsString()
  visitId?: string;

  @ApiProperty({ description: '牙位', example: 16, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  toothNumber?: number;

  @ApiProperty({ description: '治疗状态', enum: TreatmentStatus, example: TreatmentStatus.IN_PROGRESS, required: false })
  @IsOptional()
  @IsEnum(TreatmentStatus)
  status?: TreatmentStatus;
}
