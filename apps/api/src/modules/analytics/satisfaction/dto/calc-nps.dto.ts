import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CalcNpsDto {
  @ApiProperty({ description: '开始日期 (ISO YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiProperty({ description: '结束日期 (ISO YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiProperty({ description: '按医生ID筛选（可选）', required: false })
  @IsOptional()
  @IsString()
  doctorId?: string;
}
