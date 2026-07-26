import { IsString, IsOptional, IsEnum, MaxLength, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { NotificationType, NotificationPriority } from '../types/notification.types';

export class CreateNotificationDto {
  @ApiProperty({ description: '通知类型', enum: NotificationType, example: NotificationType.APPOINTMENT })
  @IsEnum(NotificationType)
  type!: NotificationType;

  @ApiProperty({ description: '通知标题', example: '预约提醒' })
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: '通知内容', example: '您明天10:00有一个预约' })
  @IsString()
  @MaxLength(2000)
  content!: string;

  @ApiProperty({ description: '通知优先级', enum: NotificationPriority, example: NotificationPriority.NORMAL })
  @IsEnum(NotificationPriority)
  priority!: NotificationPriority;

  @ApiProperty({ description: '接收用户ID', example: 'user-uuid-001', required: false })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiProperty({ description: '附加数据', example: { appointmentId: 'apt-001' }, required: false })
  @IsOptional()
  data?: Record<string, unknown>;
}

export class QueryNotificationDto {
  @ApiProperty({ description: '通知类型', enum: NotificationType, example: NotificationType.APPOINTMENT, required: false })
  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @ApiProperty({ description: '通知优先级', enum: NotificationPriority, example: NotificationPriority.NORMAL, required: false })
  @IsOptional()
  @IsEnum(NotificationPriority)
  priority?: NotificationPriority;

  @ApiProperty({ description: '是否已读', example: false, required: false })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  isRead?: boolean;

  @ApiProperty({ description: '搜索关键词', example: '预约', required: false })
  @IsOptional()
  @IsString()
  keyword?: string;
}
