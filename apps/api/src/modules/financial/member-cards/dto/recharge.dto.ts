import { IsNumber, IsString, IsOptional, Min, Max, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RechargeDto {
  @ApiProperty({ description: '充值金额', example: 1000 })
  @IsNumber() @Min(0.01) @Max(99999999.99) amount!: number;

  @ApiProperty({ description: '备注', example: '会员充值活动赠送200', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
}
