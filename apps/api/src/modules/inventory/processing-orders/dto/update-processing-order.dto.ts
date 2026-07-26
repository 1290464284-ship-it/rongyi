import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, Min, IsInt, MaxLength, IsIn } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

const PROCESSING_ORDER_STATUSES = ['PENDING', 'SENT', 'IN_PROGRESS', 'COMPLETED', 'RECEIVED', 'CANCELLED'];

export class UpdateProcessingOrderItemDto {
  @ApiProperty({ description: '加工项目ID', example: 'item-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100)
  id?: string;

  @ApiProperty({ description: '产品ID', example: 'product-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100)
  productId?: string;

  @ApiProperty({ description: '产品名称', example: '烤瓷牙冠', required: false })
  @IsOptional() @IsString() @MaxLength(100)
  productName?: string;

  @ApiProperty({ description: '牙位号', example: 16, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  toothNumber?: number;

  @ApiProperty({ description: '数量', example: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity?: number;

  @ApiProperty({ description: '单价', example: 1500, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice?: number;

  @ApiProperty({ description: '备注', example: '需比色A2', required: false })
  @IsOptional() @IsString() @MaxLength(500)
  remark?: string;
}

export class UpdateProcessingOrderDto {
  @ApiProperty({ description: '加工厂ID', example: 'factory-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) factoryId?: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) doctorId?: string;

  @ApiProperty({ description: '比色结果', example: 'A2', required: false })
  @IsOptional() @IsString() @MaxLength(50) shade?: string;

  @ApiProperty({ description: '涉及牙位列表', type: 'array', items: { type: 'string' }, example: ['16', '26'], required: false })
  @IsOptional() @IsArray() teethNumbers?: string[];

  @ApiProperty({ description: '预计完成时间', example: '2024-01-25', required: false })
  @IsOptional() @IsString() @MaxLength(20) expectedAt?: string;

  @ApiProperty({ description: '备注', example: '加急处理', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;

  @ApiProperty({ description: '加工项目列表', type: () => [UpdateProcessingOrderItemDto], required: false })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateProcessingOrderItemDto)
  items?: UpdateProcessingOrderItemDto[];
}

export class UpdateStatusDto {
  @ApiProperty({ description: '加工单状态', enum: PROCESSING_ORDER_STATUSES, example: 'IN_PROGRESS' })
  @IsString() @IsIn(PROCESSING_ORDER_STATUSES) status!: string;

  @ApiProperty({ description: '状态变更备注', example: '加工厂已开始制作', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
}

export class AddFlowLogDto {
  @ApiProperty({ description: '加工单状态', enum: PROCESSING_ORDER_STATUSES, example: 'SENT' })
  @IsString() @IsIn(PROCESSING_ORDER_STATUSES) status!: string;

  @ApiProperty({ description: '流程日志备注', example: '已发送至加工厂', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
}

export class LinkChargeDto {
  @ApiProperty({ description: '关联收费单ID', example: 'charge-uuid-001' })
  @IsString() @MaxLength(100) chargeId!: string;
}
