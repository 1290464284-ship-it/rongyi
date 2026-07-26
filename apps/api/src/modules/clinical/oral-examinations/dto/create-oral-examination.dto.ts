import { IsString, IsOptional, IsArray, IsDateString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateOralExaminationDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString() @MaxLength(100) patientId!: string;

  @ApiProperty({ description: '就诊ID', example: 'visit-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) visitId?: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) doctorId?: string;

  @ApiProperty({ description: '检查日期', example: '2024-01-15' })
  @IsDateString() examDate!: string;

  @ApiProperty({ description: '菌斑指数', example: '2级', required: false })
  @IsOptional() @IsString() @MaxLength(50) plaqueIndex?: string;

  @ApiProperty({ description: '牙结石指数', example: '1级', required: false })
  @IsOptional() @IsString() @MaxLength(50) calculusIndex?: string;

  @ApiProperty({ description: '出血指数', example: '1级', required: false })
  @IsOptional() @IsString() @MaxLength(50) bleedingIndex?: string;

  @ApiProperty({ description: '龋齿列表', type: 'array', items: {}, example: [{ tooth: '16', surface: '咬合面' }], required: false })
  @IsOptional() @IsArray() caries?: unknown[];

  @ApiProperty({ description: '松动牙列表', type: 'array', items: {}, example: [{ tooth: '21', degree: 'I度' }], required: false })
  @IsOptional() @IsArray() looseTeeth?: unknown[];

  @ApiProperty({ description: '叩痛牙位列表', type: 'array', items: {}, example: [{ tooth: '36', pain: '+' }], required: false })
  @IsOptional() @IsArray() percussionPain?: unknown[];

  @ApiProperty({ description: '牙髓活力列表', type: 'array', items: {}, example: [{ tooth: '11', vitality: '正常' }], required: false })
  @IsOptional() @IsArray() pulpVitality?: unknown[];

  @ApiProperty({ description: '黏膜情况', example: '口腔黏膜光滑，未见异常', required: false })
  @IsOptional() @IsString() @MaxLength(2000) mucosa?: string;

  @ApiProperty({ description: '颞下颌关节情况', example: '开闭口正常，无弹响', required: false })
  @IsOptional() @IsString() @MaxLength(2000) tmj?: string;

  @ApiProperty({ description: '备注', example: '患者口腔卫生一般，建议洗牙', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
}
