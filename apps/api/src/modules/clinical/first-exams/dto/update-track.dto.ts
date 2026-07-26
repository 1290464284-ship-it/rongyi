import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UpdateTrackDto {
  @ApiProperty({ description: '追踪状态', example: 'PENDING', required: false })
  @IsOptional() @IsString() @MaxLength(50) status?: string;

  @ApiProperty({ description: '组长建议', example: '建议患者进行根管治疗', required: false })
  @IsOptional() @IsString() @MaxLength(2000) leaderSuggestion?: string;

  @ApiProperty({ description: '主任建议', example: '同意治疗方案', required: false })
  @IsOptional() @IsString() @MaxLength(2000) directorSuggestion?: string;

  @ApiProperty({ description: '流失原因', example: '价格过高', required: false })
  @IsOptional() @IsString() @MaxLength(500) churnReason?: string;

  @ApiProperty({ description: '流失解决方案', example: '提供优惠方案', required: false })
  @IsOptional() @IsString() @MaxLength(2000) churnSolution?: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) doctorId?: string;
}
