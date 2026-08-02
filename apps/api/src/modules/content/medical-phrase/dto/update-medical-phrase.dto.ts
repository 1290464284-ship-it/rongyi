import {
  IsString,
  IsOptional,
  IsArray,
  MaxLength,
  IsInt,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ToothStatus, ToothCondition } from '@dental/shared';

export class UpdateMedicalPhraseDto {
  @ApiProperty({ description: '短语名称', example: '龋洞充填（改良）', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ description: '分类', example: '牙体牙髓', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiProperty({ description: '短语内容', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  content?: string;

  @ApiProperty({ description: '置顶排序值（0=未置顶，越大越靠前）', example: 5, required: false })
  @IsOptional()
  @IsInt()
  @Min(0)
  pinOrder?: number;

  @ApiProperty({
    description: '触发推荐的牙位状态枚举数组',
    type: [String],
    example: [ToothStatus.DECAYED],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  triggerToothStatuses?: ToothStatus[];

  @ApiProperty({
    description: '触发推荐的牙位情况枚举数组',
    type: [String],
    example: [ToothCondition.DECAY],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  triggerToothConditions?: ToothCondition[];
}
