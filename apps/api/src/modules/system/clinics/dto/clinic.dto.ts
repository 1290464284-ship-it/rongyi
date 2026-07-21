import { IsString, IsOptional, IsBoolean, IsNotEmpty, MaxLength, Matches } from 'class-validator';

export class CreateClinicDto {
  @IsString()
  @IsNotEmpty({ message: '诊所名称不能为空' })
  @MaxLength(100)
  name: string;

  @IsString()
  @IsNotEmpty({ message: '诊所编码不能为空' })
  @Matches(/^[A-Z0-9_-]+$/i, { message: '诊所编码只能包含字母、数字、下划线和连字符' })
  @MaxLength(50)
  code: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  legalPerson?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  businessLicense?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}

export class UpdateClinicDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  legalPerson?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  businessLicense?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  remark?: string;
}
