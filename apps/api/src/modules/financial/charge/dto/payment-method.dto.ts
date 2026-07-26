import { IsString, IsOptional, IsInt, Min, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreatePaymentMethodDto {
  @ApiProperty({ description: '支付方式名称', example: '微信支付' })
  @IsString()
  @MaxLength(50)
  name!: string;

  @ApiProperty({ description: '支付方式编码', example: 'WECHAT' })
  @IsString()
  @MaxLength(50)
  code!: string;

  @ApiProperty({ description: '父级支付方式ID', example: 'parent-uuid-001', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  parentId?: string;

  @ApiProperty({ description: '排序', example: 1, required: false })
  @IsInt()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  sortOrder?: number;
}

export class UpdatePaymentMethodDto {
  @ApiProperty({ description: '支付方式名称', example: '微信支付', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  name?: string;

  @ApiProperty({ description: '支付方式编码', example: 'WECHAT', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(50)
  code?: string;

  @ApiProperty({ description: '父级支付方式ID', example: 'parent-uuid-001', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  parentId?: string;

  @ApiProperty({ description: '排序', example: 1, required: false })
  @IsInt()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  sortOrder?: number;
}
