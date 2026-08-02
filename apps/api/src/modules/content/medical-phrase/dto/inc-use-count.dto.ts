import {
  IsArray,
  IsString,
  ArrayMinSize,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class IncUseCountDto {
  @ApiProperty({
    description: '需要增加使用次数的短语 ID 列表',
    type: [String],
    example: ['phrase-uuid-001', 'phrase-uuid-002'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  phraseIds!: string[];
}
