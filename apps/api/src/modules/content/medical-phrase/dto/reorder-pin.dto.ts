import {
  IsString,
  IsInt,
  Min,
  IsArray,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class PinOrderEntryDto {
  @ApiProperty({ description: '短语 ID', example: 'phrase-uuid-001' })
  @IsString()
  phraseId!: string;

  @ApiProperty({ description: '新的 pinOrder 值（>=0）', example: 3 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  order!: number;
}

export class ReorderPinDto {
  @ApiProperty({ description: '批量更新 pinOrder 的条目列表', type: () => [PinOrderEntryDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PinOrderEntryDto)
  entries!: PinOrderEntryDto[];
}
