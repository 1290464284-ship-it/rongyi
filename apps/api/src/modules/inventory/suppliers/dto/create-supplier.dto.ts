import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateSupplierDto {
  @ApiProperty({ description: '供应商名称', example: '北京医疗器械有限公司' })
  @IsString() @MaxLength(100) name!: string;

  @ApiProperty({ description: '联系人', example: '张经理', required: false })
  @IsOptional() @IsString() @MaxLength(50) contactPerson?: string;

  @ApiProperty({ description: '联系电话', example: '13800138000', required: false })
  @IsOptional() @IsString() @MaxLength(20) phone?: string;

  @ApiProperty({ description: '地址', example: '北京市朝阳区xx路xx号', required: false })
  @IsOptional() @IsString() @MaxLength(200) address?: string;

  @ApiProperty({ description: '银行账户', example: '622202xxxxxx', required: false })
  @IsOptional() @IsString() @MaxLength(50) bankAccount?: string;

  @ApiProperty({ description: '备注', example: '长期合作供应商', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
}

export class UpdateSupplierDto {
  @ApiProperty({ description: '供应商名称', example: '北京医疗器械有限公司', required: false })
  @IsOptional() @IsString() @MaxLength(100) name?: string;

  @ApiProperty({ description: '联系人', example: '张经理', required: false })
  @IsOptional() @IsString() @MaxLength(50) contactPerson?: string;

  @ApiProperty({ description: '联系电话', example: '13800138000', required: false })
  @IsOptional() @IsString() @MaxLength(20) phone?: string;

  @ApiProperty({ description: '地址', example: '北京市朝阳区xx路xx号', required: false })
  @IsOptional() @IsString() @MaxLength(200) address?: string;

  @ApiProperty({ description: '银行账户', example: '622202xxxxxx', required: false })
  @IsOptional() @IsString() @MaxLength(50) bankAccount?: string;

  @ApiProperty({ description: '备注', example: '长期合作供应商', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
}
