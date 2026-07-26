import { IsString, IsOptional, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateModifyRequestDto {
  @ApiProperty({ description: '病历ID', example: 'record-uuid-001' })
  @IsString() @MaxLength(100) recordId!: string;

  @ApiProperty({ description: '修改原因', example: '补充诊断信息' })
  @IsString() @MaxLength(500) reason!: string;
}

export class ReviewModifyRequestDto {
  @ApiProperty({ description: '审核状态', example: 'approved' })
  @IsString() @MaxLength(50) status!: string;

  @ApiProperty({ description: '审核备注', example: '同意修改', required: false })
  @IsOptional() @IsString() @MaxLength(500) reviewRemark?: string;
}
