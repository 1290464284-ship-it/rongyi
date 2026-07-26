import { IsString, IsOptional, IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { MAX_PAGE_SIZE } from '../../../../common/constants/pagination';

export class CreateFactoryDto {
  @ApiProperty({ description: '加工厂名称', example: '精益义齿加工中心' })
  @IsString() name!: string;

  @ApiProperty({ description: '联系人', example: '张经理', required: false })
  @IsOptional() @IsString() contactPerson?: string;

  @ApiProperty({ description: '联系电话', example: '13800138000', required: false })
  @IsOptional() @IsString() phone?: string;

  @ApiProperty({ description: '地址', example: '北京市朝阳区xx路xx号', required: false })
  @IsOptional() @IsString() address?: string;

  @ApiProperty({ description: '备注', example: '合作多年，质量稳定', required: false })
  @IsOptional() @IsString() remark?: string;
}

export class UpdateFactoryDto {
  @ApiProperty({ description: '加工厂名称', example: '精益义齿加工中心', required: false })
  @IsOptional() @IsString() name?: string;

  @ApiProperty({ description: '联系人', example: '张经理', required: false })
  @IsOptional() @IsString() contactPerson?: string;

  @ApiProperty({ description: '联系电话', example: '13800138000', required: false })
  @IsOptional() @IsString() phone?: string;

  @ApiProperty({ description: '地址', example: '北京市朝阳区xx路xx号', required: false })
  @IsOptional() @IsString() address?: string;

  @ApiProperty({ description: '备注', example: '合作多年，质量稳定', required: false })
  @IsOptional() @IsString() remark?: string;

  @ApiProperty({ description: '状态', example: 'active', required: false })
  @IsOptional() @IsString() status?: string;
}

export class QueryFactoryDto {
  @ApiProperty({ description: '搜索关键词', example: '精益', required: false })
  @IsOptional() @IsString() keyword?: string;

  @ApiProperty({ description: '状态', example: 'active', required: false })
  @IsOptional() @IsString() status?: string;

  @ApiProperty({ description: '页码', example: 1, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiProperty({ description: '每页数量', example: 50, required: false })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number = 50;
}
