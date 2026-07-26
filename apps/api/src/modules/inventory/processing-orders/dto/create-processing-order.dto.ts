import { IsString, IsOptional, IsArray, ValidateNested, IsNumber, Min, IsInt, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class ProcessingOrderItemDto {
  @ApiProperty({ description: '产品ID', example: 'product-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100)
  productId?: string;

  @ApiProperty({ description: '产品名称', example: '烤瓷牙冠' })
  @IsString() @MaxLength(100)
  productName!: string;

  @ApiProperty({ description: '牙位号', example: 16, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  toothNumber?: number;

  @ApiProperty({ description: '数量', example: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  quantity!: number;

  @ApiProperty({ description: '单价', example: 1500 })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  unitPrice!: number;

  @ApiProperty({ description: '备注', example: '需比色A2', required: false })
  @IsOptional() @IsString() @MaxLength(500)
  remark?: string;
}

export class CreateProcessingOrderDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString() @MaxLength(100) patientId!: string;

  @ApiProperty({ description: '就诊记录ID', example: 'visit-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) visitId?: string;

  @ApiProperty({ description: '加工厂ID', example: 'factory-uuid-001' })
  @IsString() @MaxLength(100) factoryId!: string;

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

  @ApiProperty({ description: '加工项目列表', type: () => [ProcessingOrderItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProcessingOrderItemDto)
  items!: ProcessingOrderItemDto[];
}
