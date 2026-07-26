import { IsString, IsOptional, IsNumber, IsDateString, MaxLength } from 'class-validator';
import { PartialType, ApiProperty } from '@nestjs/swagger';

export class CreateEquipmentDto {
  @ApiProperty({ description: '设备名称', example: '牙科综合治疗台' })
  @IsString() @MaxLength(100) name!: string;

  @ApiProperty({ description: '设备型号', example: 'A-dec 500', required: false })
  @IsOptional() @IsString() @MaxLength(100) model?: string;

  @ApiProperty({ description: '品牌', example: 'A-dec', required: false })
  @IsOptional() @IsString() @MaxLength(100) brand?: string;

  @ApiProperty({ description: '序列号', example: 'SN202401001', required: false })
  @IsOptional() @IsString() @MaxLength(100) serialNumber?: string;

  @ApiProperty({ description: '设备分类', example: '治疗设备', required: false })
  @IsOptional() @IsString() @MaxLength(50) category?: string;

  @ApiProperty({ description: '存放位置', example: '1号诊室', required: false })
  @IsOptional() @IsString() @MaxLength(200) location?: string;

  @ApiProperty({ description: '购置价格', example: 150000, required: false })
  @IsOptional() @IsNumber() purchasePrice?: number;

  @ApiProperty({ description: '购置日期', example: '2024-01-15', required: false })
  @IsOptional() @IsDateString() purchaseDate?: string;

  @ApiProperty({ description: '供应商', example: 'xx医疗器械公司', required: false })
  @IsOptional() @IsString() @MaxLength(100) supplier?: string;

  @ApiProperty({ description: '设备状态', example: 'active', required: false })
  @IsOptional() @IsString() @MaxLength(50) status?: string;

  @ApiProperty({ description: '备注', example: '定期维护', required: false })
  @IsOptional() @IsString() @MaxLength(500) remarks?: string;
}

export class UpdateEquipmentDto extends PartialType(CreateEquipmentDto) {}

export class QueryEquipmentDto {
  @ApiProperty({ description: '搜索关键词', example: '治疗台', required: false })
  @IsOptional() @IsString() keyword?: string;

  @ApiProperty({ description: '设备名称', example: '牙科综合治疗台', required: false })
  @IsOptional() @IsString() name?: string;

  @ApiProperty({ description: '设备分类', example: '治疗设备', required: false })
  @IsOptional() @IsString() category?: string;

  @ApiProperty({ description: '设备状态', example: 'active', required: false })
  @IsOptional() @IsString() status?: string;

  @ApiProperty({ description: '开始日期', example: '2024-01-01', required: false })
  @IsOptional() @IsString() startDate?: string;

  @ApiProperty({ description: '结束日期', example: '2024-12-31', required: false })
  @IsOptional() @IsString() endDate?: string;
}
