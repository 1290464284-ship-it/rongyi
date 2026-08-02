import { IsArray, IsString, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class IgnoreSuggestionsDto {
  @ApiProperty({ description: '建议ID列表', type: [String], example: ['suggest-uuid-001', 'suggest-uuid-002'] })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  ids!: string[];
}
