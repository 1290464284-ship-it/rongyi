import { IsString, IsOptional, IsBoolean, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateChairDto {
  @ApiProperty({ description: '椅位名称', example: '1号椅位' })
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiProperty({ description: '位置描述', example: '一楼诊室A', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;
}

export class UpdateChairDto {
  @ApiProperty({ description: '椅位名称', example: '1号椅位', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiProperty({ description: '位置描述', example: '一楼诊室A', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @ApiProperty({ description: '是否启用', example: true, required: false })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
