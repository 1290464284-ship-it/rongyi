import { IsString, IsOptional, IsIn, IsNotEmpty, MaxLength, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export type PrintTemplateCode = 'PRESCRIPTION' | 'RECEIPT' | 'TREATMENT_PLAN' | 'CLINIC_REPORT' | 'CEPHALOMETRIC_REPORT';
export type PrintTemplateCategory = 'PRESCRIPTION' | 'FINANCIAL' | 'CLINICAL' | 'REPORT';
export type PaperSize = 'A4' | 'A5' | 'RECEIPT';
export type Orientation = 'portrait' | 'landscape';

export interface PrintTemplateEntity {
  id: string;
  code: PrintTemplateCode | string;
  name: string;
  category: PrintTemplateCategory;
  content: string;
  variables: string;
  isDefault: number;
  paperSize: PaperSize;
  orientation: Orientation;
  clinicId: string;
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

export class SavePrintTemplateDto {
  @ApiProperty({ description: '模板名称', example: '标准处方单' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: 'HTML 模板内容', example: '<div>Hello {{patient.name}}</div>' })
  @IsString()
  @IsNotEmpty()
  content!: string;

  @ApiProperty({ description: '模板分类', example: 'PRESCRIPTION', required: false, enum: ['PRESCRIPTION', 'FINANCIAL', 'CLINICAL', 'REPORT'] })
  @IsOptional()
  @IsIn(['PRESCRIPTION', 'FINANCIAL', 'CLINICAL', 'REPORT'])
  category?: PrintTemplateCategory;

  @ApiProperty({ description: 'JSON 变量定义', example: '{"patient":{"name":"患者姓名"}}', required: false })
  @IsOptional()
  @IsObject()
  variables?: Record<string, unknown>;

  @ApiProperty({ description: '纸张大小', example: 'A4', required: false, enum: ['A4', 'A5', 'RECEIPT'] })
  @IsOptional()
  @IsIn(['A4', 'A5', 'RECEIPT'])
  paperSize?: PaperSize;

  @ApiProperty({ description: '纸张方向', example: 'portrait', required: false, enum: ['portrait', 'landscape'] })
  @IsOptional()
  @IsIn(['portrait', 'landscape'])
  orientation?: Orientation;
}

export class PrintPreviewDto {
  @ApiProperty({ description: '示例上下文数据', example: '{patient:{name:"张三"}}' })
  @IsObject()
  sampleContext!: Record<string, unknown>;
}

export class ClinicReportQueryDto {
  @ApiProperty({ description: '月份 YYYY-MM', example: '2024-08', required: false })
  @IsOptional()
  @IsString()
  month?: string;
}

export class ListTemplatesQueryDto {
  @ApiProperty({ description: '按分类过滤', example: 'FINANCIAL', required: false, enum: ['PRESCRIPTION', 'FINANCIAL', 'CLINICAL', 'REPORT'] })
  @IsOptional()
  @IsIn(['PRESCRIPTION', 'FINANCIAL', 'CLINICAL', 'REPORT'])
  category?: PrintTemplateCategory;
}
