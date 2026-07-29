import { IsString, IsOptional, IsNumber, IsArray, Min, ValidateNested, IsInt, MaxLength, ArrayMinSize, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { MAX_PAGE_SIZE } from '../../../../common/constants/pagination';

export class ChargeItemDto {
  @ApiProperty({ description: '项目名称', example: '洗牙' })
  @IsString() @MaxLength(100) name!: string;

  @ApiProperty({ description: '项目类别', example: '基础治疗', required: false })
  @IsOptional() @IsString() @MaxLength(50) category?: string;

  @ApiProperty({ description: '单价', example: 200, required: false })
  @IsOptional() @Type(() => Number) @IsNumber() @Min(0) price?: number;

  @ApiProperty({ description: '数量', example: 1, required: false })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) quantity?: number;

  @ApiProperty({ description: '关联牙位', type: 'array', items: { type: 'string' }, example: ['16', '26'], required: false })
  @IsOptional() @IsArray() @IsString({ each: true }) teethNumbers?: string[];
}

export class CreateChargeDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString() @MaxLength(100) patientId!: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) doctorId?: string;

  @ApiProperty({ description: '备注', example: '首次就诊优惠', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;

  @ApiProperty({ description: '收费项目列表', type: () => [ChargeItemDto] })
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ChargeItemDto)
  items!: ChargeItemDto[];

  @ApiProperty({ description: '请求ID（幂等性）— 客户端在重试时使用同一 requestId 防止重复创建收费单', example: 'req-20240115-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) requestId?: string;
}

export class QueryChargesDto {
  @ApiProperty({ description: '页码', example: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiProperty({ description: '每页数量', example: 20, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number;

  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiProperty({ description: '状态', example: 'paid', required: false })
  @IsOptional()
  @IsString()
  status?: string;
}
