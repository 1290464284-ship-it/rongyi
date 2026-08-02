import {
  IsString,
  IsOptional,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export enum MedicalPhraseScope {
  PUBLIC = 'PUBLIC',
  MINE = 'MINE',
  ALL = 'ALL',
}

export enum MedicalPhraseSort {
  PIN_FIRST = 'PIN_FIRST',
  RECENT = 'RECENT',
  HOT = 'HOT',
}

export class ListMedicalPhraseDto {
  @ApiProperty({ description: '分类过滤', example: '牙体牙髓', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiProperty({ description: '关键词搜索（name/content 模糊匹配）', example: 'rct', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiProperty({
    description: '可见范围',
    enum: MedicalPhraseScope,
    example: MedicalPhraseScope.ALL,
    required: false,
  })
  @IsOptional()
  @IsEnum(MedicalPhraseScope)
  scope?: MedicalPhraseScope;

  @ApiProperty({
    description: '排序方式',
    enum: MedicalPhraseSort,
    example: MedicalPhraseSort.PIN_FIRST,
    required: false,
  })
  @IsOptional()
  @IsEnum(MedicalPhraseSort)
  sort?: MedicalPhraseSort;
}
