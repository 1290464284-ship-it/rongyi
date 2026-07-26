import { IsNumber, IsString, IsOptional, Min, Max, MaxLength, IsIn } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PayMethod } from '@dental/shared';

const PAY_METHOD_VALUES = Object.values(PayMethod);

export class PayChargeDto {
  @ApiProperty({ description: '支付金额', example: 500 })
  @IsNumber()
  @Min(0.01)
  @Max(99999999.99)
  amount!: number;

  @ApiProperty({ description: '支付方式', enum: PayMethod, example: PayMethod.CASH, required: false })
  @IsOptional()
  @IsIn(PAY_METHOD_VALUES)
  @MaxLength(50)
  payMethod?: string;

  @ApiProperty({ description: '请求ID（幂等用）', example: 'req-20240115-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  requestId?: string;

  @ApiProperty({ description: '会员卡ID（使用会员卡支付时）', example: 'card-uuid-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  memberCardId?: string;
}
