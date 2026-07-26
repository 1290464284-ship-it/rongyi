import { IsString, IsNumber, IsOptional, Min, Max, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRefundDto {
  @ApiProperty({ description: '收费单ID', example: 'charge-uuid-001' })
  @IsString() @MaxLength(100) chargeId!: string;

  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString() @MaxLength(100) patientId!: string;

  @ApiProperty({ description: '退款金额', example: 100 })
  @IsNumber() @Type(() => Number) @Min(0.01) @Max(99999999.99) amount!: number;

  @ApiProperty({ description: '退款原因', example: '患者取消治疗', required: false })
  @IsOptional() @IsString() @MaxLength(500) reason?: string;

  @ApiProperty({ description: '请求ID（幂等用）', example: 'refund-20240115-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) requestId?: string;
}
