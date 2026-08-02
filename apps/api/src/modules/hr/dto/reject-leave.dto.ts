import { IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RejectLeaveDto {
  @ApiProperty({ description: '拒绝原因（非空必填）', example: '出差冲突，请调整日期' })
  @IsString()
  @MinLength(1)
  rejectReason!: string;
}
