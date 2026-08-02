import { IsString, IsOptional, MaxLength, IsIn, IsDateString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { SHIFT_TYPES, ShiftType } from '../constants';

export class CreateWorkScheduleDto {
  @ApiProperty({ description: '员工ID', example: 'user-uuid-001' })
  @IsString()
  @MaxLength(100)
  userId!: string;

  @ApiProperty({
    description: '班次类型',
    example: 'MORNING',
    enum: Object.keys(SHIFT_TYPES),
  })
  @IsIn(Object.keys(SHIFT_TYPES))
  shiftType!: ShiftType;

  @ApiProperty({ description: '开始时间 ISO datetime', example: '2025-03-10T08:00:00' })
  @IsDateString()
  startAt!: string;

  @ApiProperty({ description: '结束时间 ISO datetime', example: '2025-03-10T12:00:00' })
  @IsDateString()
  endAt!: string;

  @ApiProperty({ description: '备注', example: '早班', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  note?: string;

  @ApiProperty({ description: '重复规则（仅存储，本任务不自动生成）', example: 'WEEKLY:2;DAYS=1,3,5', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  repeatRule?: string;

  @ApiProperty({ description: '颜色', example: '#4F46E5', required: false, default: '#4F46E5' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  color?: string;
}
