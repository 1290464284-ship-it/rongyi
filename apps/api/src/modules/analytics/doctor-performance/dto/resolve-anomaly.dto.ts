import { IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResolveAnomalyDto {
  @ApiProperty({ description: '处理备注', example: '已确认医生本月休假，属正常波动', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}
