import { IsNumber, IsString, IsOptional, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class AddPointsDto {
  @ApiProperty({ description: '增加积分数量', example: 100 })
  @Type(() => Number)
  @IsNumber() @Min(1) @Max(999999)
  points: number;

  @ApiProperty({ description: '关联收费单ID', example: 'charge-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) chargeId?: string;

  @ApiProperty({ description: '备注', example: '消费赠送积分', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
}

export class DeductPointsDto {
  @ApiProperty({ description: '扣减积分数量', example: 50 })
  @Type(() => Number)
  @IsNumber() @Min(1) @Max(999999)
  points: number;

  @ApiProperty({ description: '备注', example: '积分兑换礼品', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
}

export class ConsumeDto {
  @ApiProperty({ description: '消费金额', example: 200.00 })
  @Type(() => Number)
  @IsNumber() @Min(0.01) @Max(99999999.99)
  amount: number;

  @ApiProperty({ description: '关联收费单ID', example: 'charge-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) chargeId?: string;

  @ApiProperty({ description: '备注', example: '会员卡支付', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
}

export class RefundDto {
  @ApiProperty({ description: '退款金额', example: 100.00 })
  @Type(() => Number)
  @IsNumber() @Min(0.01) @Max(99999999.99)
  amount: number;

  @ApiProperty({ description: '关联收费单ID', example: 'charge-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) chargeId?: string;

  @ApiProperty({ description: '备注', example: '取消治疗退款', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
}
