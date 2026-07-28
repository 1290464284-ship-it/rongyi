import { IsString, IsDateString, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * sync pull 查询参数
 *
 * P0 修复：原 controller 直接接受 string 类型的 since/deviceId，无任何校验。
 * - since 必须是合法 ISO 8601 日期字符串，否则 SQL 比较结果不可预期
 * - deviceId 必须非空且长度受限，防止注入或日志膨胀
 */
export class SyncPullQueryDto {
  @ApiProperty({ description: '上次同步时间戳 (ISO 8601)', example: '2026-07-28T08:00:00.000Z' })
  @IsDateString()
  @MaxLength(64)
  since!: string;

  @ApiProperty({ description: '客户端设备 ID', example: 'device-uuid-001' })
  @IsString()
  @MaxLength(128)
  deviceId!: string;
}
