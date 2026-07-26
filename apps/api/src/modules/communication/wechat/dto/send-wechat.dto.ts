import { IsString, IsOptional, IsArray, MaxLength, ArrayMaxSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendWechatDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  @IsOptional() @IsString() @MaxLength(100) patientId?: string;

  @ApiProperty({ description: '微信openId', example: 'oabcdefghijklmnopqrstuvwxyz', required: false })
  @IsOptional() @IsString() @MaxLength(100) openId?: string;

  @ApiProperty({ description: '发送内容', example: '您好，您的预约已确认' })
  @IsString() @MaxLength(2000) content!: string;

  @ApiProperty({ description: '消息类型', example: 'text', required: false })
  @IsOptional() @IsString() @MaxLength(50) type?: string;

  @ApiProperty({ description: '备注', example: '预约提醒消息', required: false })
  @IsOptional() @IsString() @MaxLength(500) remark?: string;
}

export class SendBatchWechatDto {
  @ApiProperty({ description: '患者ID列表', type: 'array', items: { type: 'string' }, example: ['patient-uuid-001', 'patient-uuid-002'] })
  @IsArray() @IsString({ each: true }) @ArrayMaxSize(500) patientIds!: string[];

  @ApiProperty({ description: '发送内容', example: '您好，您的预约已确认' })
  @IsString() @MaxLength(2000) content!: string;

  @ApiProperty({ description: '消息类型', example: 'text', required: false })
  @IsOptional() @IsString() @MaxLength(50) type?: string;
}
