import { IsString, IsOptional, IsBoolean, IsNotEmpty, MaxLength, Matches } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateClinicDto {
  @ApiProperty({ description: '诊所名称', example: '荣毅口腔诊所' })
  @IsString()
  @IsNotEmpty({ message: '诊所名称不能为空' })
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: '诊所编码', example: 'RY-DENTAL-001' })
  @IsString()
  @IsNotEmpty({ message: '诊所编码不能为空' })
  @Matches(/^[A-Z0-9_-]+$/i, { message: '诊所编码只能包含字母、数字、下划线和连字符' })
  @MaxLength(50)
  code: string;

  @ApiProperty({ description: '诊所地址', example: '北京市朝阳区建国路88号', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiProperty({ description: '联系电话', example: '010-12345678', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiProperty({ description: '法人代表', example: '张医生', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  legalPerson?: string;

  @ApiProperty({ description: '营业执照号', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  businessLicense?: string;

  @ApiProperty({ description: '备注', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export class UpdateClinicDto {
  @ApiProperty({ description: '诊所名称', example: '荣毅口腔诊所', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ description: '诊所地址', example: '北京市朝阳区建国路88号', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @ApiProperty({ description: '联系电话', example: '010-12345678', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiProperty({ description: '法人代表', example: '张医生', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  legalPerson?: string;

  @ApiProperty({ description: '营业执照号', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  businessLicense?: string;

  @ApiProperty({ description: '是否启用', example: true, required: false })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiProperty({ description: '备注', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
