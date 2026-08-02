import { IsArray, IsBoolean, IsOptional, IsString, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ApplySuggestionsDto {
  @ApiProperty({ description: '建议ID列表', type: [String], example: ['suggest-uuid-001', 'suggest-uuid-002'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];

  @ApiProperty({ description: '是否按供应商合并采购单', example: true, required: false })
  @IsOptional()
  @IsBoolean()
  groupBySupplier?: boolean = true;

  @ApiProperty({ description: '无供应商时的默认回退供应商ID', required: false })
  @IsOptional()
  @IsString()
  supplierIdFallback?: string;
}
