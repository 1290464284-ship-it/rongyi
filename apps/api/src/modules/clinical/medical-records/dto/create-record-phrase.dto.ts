import { IsString, IsOptional, IsInt, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateRecordPhraseDto {
  @ApiProperty({ description: '短语名称', example: '口腔卫生良好' })
  @IsString() @MaxLength(100) name!: string;

  @ApiProperty({ description: '短语分类', example: '检查描述', required: false })
  @IsOptional() @IsString() @MaxLength(50) category?: string;

  @ApiProperty({ description: '短语内容', example: '口腔卫生良好，牙龈颜色正常' })
  @IsString() @MaxLength(2000) content!: string;

  @ApiProperty({ description: '是否公开', example: 1, required: false })
  @IsOptional() @IsInt() isPublic?: number;
}
