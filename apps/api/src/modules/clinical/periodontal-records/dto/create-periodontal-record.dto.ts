import { IsString, IsOptional, IsDateString, IsObject, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePeriodontalRecordDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString() @MaxLength(100) patientId!: string;

  @ApiProperty({ description: '就诊记录ID', example: 'visit-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) visitId?: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) doctorId?: string;

  @ApiProperty({ description: '检查日期', example: '2024-01-15' })
  @IsDateString() examDate!: string;

  @ApiProperty({ description: '牙周检查数据', type: 'object', additionalProperties: true, example: { probingDepths: { '11': [2, 2, 3], '12': [2, 2, 2] } } })
  @IsObject() data!: Record<string, unknown>;

  @ApiProperty({ description: '备注', example: '患者口腔卫生良好', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
}
