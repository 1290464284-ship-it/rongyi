import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import { Controller, Get, Query, UseGuards, Post, Body, Req, BadRequestException } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogsService } from './operation-logs.service';

interface ErrorLog {
  timestamp: string;
  level: 'error' | 'warning' | 'info';
  message: string;
  stack?: string;
  url?: string;
  userAgent?: string;
  context?: string;
}

@UseGuards(JwtAuthGuard)
@ApiTags('操作日志')
@Controller('operation-logs')
export class OperationLogsController {
  constructor(private logs: OperationLogsService) {}

  @Get()
  @Roles(Role.BOSS)
  findMany(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.logs.findMany({ page: safePage(page), pageSize: safePageSize(pageSize, 50) });
  }

  @Post('batch')
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  async batchLog(@Body() body: { logs: ErrorLog[] }, @Req() req: { user?: { id?: string; name?: string; username?: string } }) {
    // P1 修复（审计日志可被伪造）：从 JWT 获取 userId，不信任 body 中的 userId；添加输入校验
    if (!body?.logs || !Array.isArray(body.logs) || body.logs.length === 0) {
      throw new BadRequestException('logs 不能为空');
    }
    if (body.logs.length > 50) {
      throw new BadRequestException('单次批量日志不能超过 50 条');
    }
    const userId = req.user?.id || 'system';
    const userName = req.user?.name || req.user?.username || 'system';
    for (const log of body.logs) {
      if (!log.message || typeof log.message !== 'string') continue;
      await this.logs.create({
        userId,
        userName,
        action: `[${(log.level || 'info').toUpperCase()}] ${log.message.substring(0, 500)}`,
        target: log.url ? log.url.substring(0, 500) : null,
        detail: JSON.stringify({
          stack: log.stack ? log.stack.substring(0, 2000) : undefined,
          context: log.context ? log.context.substring(0, 500) : undefined,
          userAgent: log.userAgent ? log.userAgent.substring(0, 500) : undefined,
        }),
      });
    }
    return { success: true };
  }
}
