import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class TriageRegistrationDto {
  @ApiProperty({ description: '分配医生ID', example: 'doctor-uuid-001' })
  @IsString()
  @MaxLength(100)
  doctorId!: string;

  @ApiProperty({ description: '分诊备注', example: '患者情况较紧急，优先安排', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  triageNote?: string;
}
