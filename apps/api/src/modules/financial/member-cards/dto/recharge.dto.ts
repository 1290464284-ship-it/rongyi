import { IsNumber, IsString, IsOptional, Min, Max, MaxLength, IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RechargeDto {
  @ApiProperty({ description: '充值金额', example: 1000 })
  @IsNumber() @Min(0.01) @Max(99999999.99) amount!: number;

  @ApiProperty({ description: '备注', example: '会员充值活动赠送200', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;

  @ApiProperty({
    description: '幂等键（前端生成的 UUID v4），网络重试时传入相同值可避免重复充值',
    required: false,
    example: '550e8400-e29b-41d4-a716-446655440000',
  })
  @IsOptional() @IsUUID(4) requestId?: string;
}
