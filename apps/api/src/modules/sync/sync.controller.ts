import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiQuery } from '@nestjs/swagger';
import { SyncService, SyncPushPayload } from './sync.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '@dental/shared';

@ApiTags('同步')
@Controller('sync')
@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST, Role.NURSE)
@ApiBearerAuth()
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Get('pull')
  @ApiOperation({ summary: '拉取服务端变更（增量同步）' })
  @ApiQuery({ name: 'since', required: true, description: '上次同步时间戳 (ISO 8601)' })
  @ApiQuery({ name: 'deviceId', required: true, description: '客户端设备 ID' })
  pull(
    @Query('since') since: string,
    @Query('deviceId') deviceId: string,
  ) {
    return this.syncService.pullChanges(since, deviceId);
  }

  @Post('push')
  @ApiOperation({ summary: '推送客户端变更到服务端' })
  push(@Body() payload: SyncPushPayload) {
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
