import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdatePrescriptionDto {
  @ApiProperty({ description: '备注', example: '饭后服用', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
