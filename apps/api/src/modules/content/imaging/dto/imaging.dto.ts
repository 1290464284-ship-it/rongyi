import { IsString, IsOptional, IsEnum, IsDateString, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { ImagingType } from '@dental/shared';
import { MAX_PAGE_SIZE, PAGINATION } from '../../../../common/constants/pagination';

export class CreateImagingDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001' })
  @IsString()
  patientId!: string;

  @ApiProperty({ description: '就诊记录ID', example: 'visit-uuid-001', required: false })
  @IsOptional()
  @IsString()
  visitId?: string;

  @ApiProperty({ description: '医生ID', example: 'doctor-uuid-001', required: false })
  @IsOptional()
  @IsString()
  doctorId?: string;

  @ApiProperty({ description: '影像类型', enum: ImagingType, example: ImagingType.PERIAPICAL })
  @IsEnum(ImagingType)
  type!: ImagingType;

  @ApiProperty({ description: '影像标题', example: '16根尖片' })
  @IsString()
  title!: string;

  @ApiProperty({ description: '影像描述', example: '16牙根管治疗术前片', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '影像图片URL', example: 'https://example.com/images/xray001.jpg' })
  @IsString()
  imageUrl!: string;

  @ApiProperty({ description: '缩略图URL', required: false })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiProperty({ description: '拍摄时间', example: '2024-01-15T10:30:00.000Z', required: false })
  @IsOptional()
  @IsDateString()
  takenAt?: string;

  @ApiProperty({ description: '备注', required: false })
  @IsOptional()
  @IsString()
  remark?: string;
}

export class QueryImagingDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  @IsOptional()
  @IsString()
  patientId?: string;

  @ApiProperty({ description: '影像类型', enum: ImagingType, example: ImagingType.PERIAPICAL, required: false })
  @IsOptional()
  @IsEnum(ImagingType)
  type?: ImagingType;

  @ApiProperty({ description: '开始日期', example: '2024-01-01', required: false })
  @IsOptional()
  @IsString()
  startDate?: string;

  @ApiProperty({ description: '结束日期', example: '2024-01-31', required: false })
  @IsOptional()
  @IsString()
  endDate?: string;

  @ApiProperty({ description: '页码', example: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  // P4-3: 补充 @Max 上限，防止 DoS
  @ApiProperty({ description: '每页数量', example: 20, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number = PAGINATION.DEFAULT_PAGE_SIZE;
}

export class UpdateImagingDto {
  @ApiProperty({ description: '影像类型', enum: ImagingType, example: ImagingType.PERIAPICAL, required: false })
  @IsOptional()
  @IsEnum(ImagingType)
  type?: ImagingType;

  @ApiProperty({ description: '影像标题', example: '16根尖片', required: false })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiProperty({ description: '影像描述', example: '16牙根管治疗术前片', required: false })
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ description: '影像图片URL', example: 'https://example.com/images/xray001.jpg', required: false })
  @IsOptional()
  @IsString()
  imageUrl?: string;

  @ApiProperty({ description: '缩略图URL', required: false })
  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @ApiProperty({ description: '备注', required: false })
  @IsOptional()
  @IsString()
  remark?: string;
}
