import { IsString, IsOptional, MaxLength, IsIn, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { LEAVE_TYPES, LeaveType } from '../constants';

export class CreateLeaveRequestDto {
  @ApiProperty({
    description: '请假类型',
    example: 'ANNUAL',
    enum: Object.keys(LEAVE_TYPES),
  })
  @IsIn(Object.keys(LEAVE_TYPES))
  leaveType!: LeaveType;

  @ApiProperty({ description: '开始时间 ISO datetime', example: '2025-03-10T00:00:00' })
  @IsDateString()
  startAt!: string;

  @ApiProperty({ description: '结束时间 ISO datetime', example: '2025-03-12T23:59:59' })
  @IsDateString()
  endAt!: string;

  @ApiProperty({ description: '请假原因', example: '年假回家探亲', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  reason?: string;
}
