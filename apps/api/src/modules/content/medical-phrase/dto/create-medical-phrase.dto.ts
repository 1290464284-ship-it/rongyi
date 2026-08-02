import {
  IsString,
  IsOptional,
  IsArray,
  MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ToothStatus, ToothCondition } from '@dental/shared';

export class CreateMedicalPhraseDto {
  @ApiProperty({ description: '短语名称', example: '龋洞充填' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiProperty({ description: '分类', example: '牙体牙髓', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  category?: string;

  @ApiProperty({ description: '短语内容（病历模板文本）', example: '去除腐质，备洞，酸蚀，冲洗，吹干，涂布粘结剂，光照固化，树脂充填，调合抛光。' })
  @IsString()
  @MaxLength(2000)
  content!: string;

  @ApiProperty({
    description: '触发推荐的牙位状态枚举数组',
    type: [String],
    example: [ToothStatus.DECAYED],
    required: false,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  triggerToothStatuses?: string[];

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
