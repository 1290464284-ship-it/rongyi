import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class QueryToothDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString()
  patientId!: string;
}
