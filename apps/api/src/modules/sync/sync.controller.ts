import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { SyncService } from './sync.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@dental/shared';
import { SyncPushPayloadDto } from './dto/sync-push.dto';
import { SyncPullQueryDto } from './dto/sync-pull.dto';

@ApiTags('同步')
@Controller('sync')
@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST, Role.NURSE)
@ApiBearerAuth()
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Get('pull')
  @ApiOperation({ summary: '拉取服务端变更（增量同步）' })
  // P0 修复：原先 @Query('since')/@Query('deviceId') 直接取 string，无任何校验。
  // - since 非 ISO 8601 时 SQL 字符串比较结果不可预期（可能返回全表或空集）
  // - deviceId 无长度限制，恶意客户端可推送超长字符串污染日志
  // 改用 DTO + class-validator 自动校验（GlobalValidationPipe 已全局启用）
  pull(@Query() q: SyncPullQueryDto) {
    return this.syncService.pullChanges(q.since, q.deviceId);
  }

  @Post('push')
  @ApiOperation({ summary: '推送客户端变更到服务端' })
  // P0 修复：原先 @Body() payload: SyncPushPayload 无任何校验装饰器，
  // SyncPushPayload 只是 TypeScript 接口（运行时不存在），恶意客户端可推送：
  //   - 超大 changes 数组（无上限，可触发 OOM）
  //   - 非法 operation 值（service 内 switch 不覆盖时静默跳过）
  //   - 非法 tableName（虽有 sanitizeTableName，但更早的校验更安全）
  // 改用 DTO + @ValidateNested 嵌套校验
  push(@Body() payload: SyncPushPayloadDto) {
    return this.syncService.pushChanges(payload);
  }

  @Post('cleanup')
  @Roles(Role.BOSS)
  @ApiOperation({ summary: '清理过期变更日志（仅管理员）' })
  cleanup() {
    const deleted = this.syncService.cleanupOldChanges();
    return { deleted };
  }
}
