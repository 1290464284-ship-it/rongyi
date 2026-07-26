import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class QueryOralExaminationDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  @IsOptional() @IsString() patientId?: string;

  @ApiProperty({ description: '就诊ID', example: 'visit-uuid-001', required: false })
  @IsOptional() @IsString() visitId?: string;
}
