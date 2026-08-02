import {
  IsString,
  IsOptional,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RecommendForTeethDto {
  @ApiProperty({ description: '患者 ID', example: 'patient-uuid-001' })
  @IsString()
  @MaxLength(100)
  patientId!: string;

  @ApiProperty({
    description: '指定牙位号（CSV，可选）。为空时自动取该患者所有非 SOUND 牙齿',
    example: '16,26',
    required: false,
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  toothNumbers?: string;
}
