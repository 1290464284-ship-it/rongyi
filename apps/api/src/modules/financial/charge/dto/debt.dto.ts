import { IsString, IsOptional, IsEnum, IsInt, Min, IsNumber, Max, MaxLength, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { DebtStatus, PayMethod } from '@dental/shared';
import { MAX_PAGE_SIZE, PAGINATION } from '../../../../common/constants/pagination';

export { DebtStatus };

const PAY_METHOD_VALUES = Object.values(PayMethod);

export class QueryDebtDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  patientId?: string;

  @ApiProperty({ description: '欠费状态', enum: DebtStatus, example: DebtStatus.UNPAID, required: false })
  @IsEnum(DebtStatus)
  @IsOptional()
  status?: DebtStatus;

  @ApiProperty({ description: '搜索关键字（患者姓名/电话/单号）', example: '张三', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  keyword?: string;

  @ApiProperty({ description: '开始日期', example: '2024-01-01', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  startDate?: string;

  @ApiProperty({ description: '结束日期', example: '2024-01-31', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(20)
  endDate?: string;

  @ApiProperty({ description: '页码', example: 1, required: false })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  @IsOptional()
  page = 1;

  @ApiProperty({ description: '每页数量', example: 20, required: false })
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  @Type(() => Number)
  @IsOptional()
  pageSize: number = PAGINATION.DEFAULT_PAGE_SIZE;
}

export class CreateDebtFromChargeDto {
  @ApiProperty({ description: '收费单ID', example: 'charge-uuid-001' })
  @IsString()
  @MaxLength(100)
  chargeId!: string;

  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString()
  @MaxLength(100)
  patientId!: string;

  @ApiProperty({ description: '总金额', example: 1000 })
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  totalAmount!: number;

  @ApiProperty({ description: '欠费金额', example: 500 })
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  debtAmount!: number;

  @ApiProperty({ description: '备注', example: '分期付款', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string;

  @ApiProperty({ description: '请求ID（幂等性）— 客户端在重试时使用同一 requestId 防止重复创建欠费记录', example: 'req-20240115-001', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  requestId?: string;
}

export class PayDebtDto {
  @ApiProperty({ description: '支付金额', example: 500 })
  @IsNumber()
  @Min(0.01)
  @Max(99999999.99)
  @Type(() => Number)
  amount!: number;

  @ApiProperty({ description: '支付方式', enum: PayMethod, example: PayMethod.CASH, required: false })
  @IsOptional()
  @IsIn(PAY_METHOD_VALUES)
  @MaxLength(50)
  payMethod?: string;

  @ApiProperty({ description: '备注', example: '现金支付', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(500)
  remark?: string;

  @ApiProperty({ description: '请求ID（幂等性）', example: 'req-20240115-001', required: false })
  @IsString()
  @IsOptional()
  @MaxLength(100)
  requestId?: string;
}
