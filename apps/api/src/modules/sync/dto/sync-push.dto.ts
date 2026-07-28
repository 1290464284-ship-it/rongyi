import { IsString, IsArray, IsOptional, IsIn, MaxLength, ValidateNested, IsDateString, ArrayMaxSize } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

/**
 * 单条变更项（客户端推送）
 *
 * P0 修复：sync push 接口原先接受任意 payload，无任何校验。
 * 恶意/异常客户端可推送超大 changes 数组、非法 operation、非法 tableName 触发未定义行为。
 * 此 DTO 限制单条变更的字段类型与长度，配合 controller 的 @Body() 装饰器自动校验。
 */
export class SyncChangeItemDto {
  @ApiProperty({ description: '表名（仅允许字母/数字/下划线）', example: 'Patient' })
  @IsString()
  @MaxLength(64)
  @IsOptional() // sanitizeTableName 会在 service 内二次校验
  tableName!: string;

  @ApiProperty({ description: '记录 ID', example: 'p-uuid-001' })
  @IsString()
  @MaxLength(64)
  recordId!: string;

  @ApiProperty({ description: '操作类型', enum: ['INSERT', 'UPDATE', 'DELETE'] })
  @IsIn(['INSERT', 'UPDATE', 'DELETE'])
  operation!: 'INSERT' | 'UPDATE' | 'DELETE';

  @ApiProperty({ description: '变更数据（INSERT/UPDATE 必填，DELETE 可空）', required: false, type: Object })
  @IsOptional()
  data?: Record<string, unknown>;

  @ApiProperty({ description: '客户端记录的更新时间（ISO 8601）', example: '2026-07-28T08:00:00.000Z' })
  @IsDateString()
  updatedAt!: string;
}

/**
 * sync push 请求体
 */
export class SyncPushPayloadDto {
  @ApiProperty({ description: '客户端设备 ID', example: 'device-uuid-001' })
  @IsString()
  @MaxLength(128)
  deviceId!: string;

  @ApiProperty({ description: '变更列表（单次最多 500 条）', type: [SyncChangeItemDto] })
  @IsArray()
  @ArrayMaxSize(500) // P0 修复：防止恶意客户端推送超大数组触发 OOM 或长事务
  @ValidateNested({ each: true })
  @Type(() => SyncChangeItemDto)
  changes!: SyncChangeItemDto[];
}
