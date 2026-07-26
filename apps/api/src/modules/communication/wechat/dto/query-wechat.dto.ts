import { IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class QueryWechatDto {
  @ApiProperty({ description: '患者ID', example: 'patient-uuid-001', required: false })
  @IsOptional() @IsString() patientId?: string;

  @ApiProperty({ description: '消息类型', example: 'appointment_reminder', required: false })
  @IsOptional() @IsString() type?: string;

  @ApiProperty({ description: '发送状态', example: 'sent', required: false })
  @IsOptional() @IsString() status?: string;
}
