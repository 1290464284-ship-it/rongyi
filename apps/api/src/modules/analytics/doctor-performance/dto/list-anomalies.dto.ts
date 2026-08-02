import { IsOptional, IsString, IsIn, IsBoolean } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { PaginationQueryDto } from '../../../../common/dto/pagination.dto';

const SEVERITIES = ['INFO', 'WARN', 'CRITICAL'] as const;

export class ListAnomaliesDto extends PaginationQueryDto {
  @ApiProperty({ description: '严重度筛选', enum: SEVERITIES, required: false })
  @IsOptional()
  @IsString()
  @IsIn(SEVERITIES)
  severity?: string;

  @ApiProperty({ description: '是否仅显示未解决（默认 true）', example: false, required: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  resolved?: boolean;

  @ApiProperty({ description: '指定医生ID', required: false })
  @IsOptional()
  @IsString()
  doctorId?: string;
}
