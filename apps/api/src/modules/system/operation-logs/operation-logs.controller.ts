import { BusinessValidationException } from '@common/errors';
import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import { Controller, Get, Query, Post, Body, Req } from '@nestjs/common';

import { ApiTags, ApiOperation, ApiProperty } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { IsString, IsOptional, MaxLength, IsIn, IsArray, ArrayMinSize, ArrayMaxSize, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RateLimit } from '../../../common/decorators/rate-limit.decorator';
import { OperationLogsService } from './operation-logs.service';

class ErrorLogDto {
  @ApiProperty({ description: '时间戳', example: '2024-01-15T10:00:00.000Z', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  timestamp?: string;

  @ApiProperty({ description: '日志级别', enum: ['error', 'warning', 'info'], example: 'info', required: false })
  @IsOptional()
  @IsString()
  @IsIn(['error', 'warning', 'info'])
  level?: 'error' | 'warning' | 'info';

  @ApiProperty({ description: '日志消息', example: '用户登录成功' })
  @IsString()
  @MaxLength(2000)
  message!: string;

  @ApiProperty({ description: '错误堆栈', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  stack?: string;

  @ApiProperty({ description: '请求URL', example: '/api/patients', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  url?: string;

  @ApiProperty({ description: '用户代理', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  userAgent?: string;

  @ApiProperty({ description: '上下文信息', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  context?: string;
}

class BatchLogDto {
  @ApiProperty({ description: '日志列表', type: () => [ErrorLogDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ErrorLogDto)
  logs!: ErrorLogDto[];
}

@ApiTags('操作日志')
@Controller('operation-logs')
export class OperationLogsController {
  constructor(private logs: OperationLogsService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  @Roles(Role.BOSS)
  findMany(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.logs.findMany({ page: safePage(page), pageSize: safePageSize(pageSize, 50) });
  }

  @ApiOperation({ summary: 'batchLog - 操作日志' })
  @Post('batch')
  @Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
  @RateLimit({ capacity: 20, ratePerSecond: 2 })
  async batchLog(@Body() body: BatchLogDto, @Req() req: { user?: { id?: string; name?: string; username?: string } }) {
    // P1 修复（审计日志可被伪造）：从 JWT 获取 userId，不信任 body 中的 userId；添加输入校验
    // 防御性校验：DTO 装饰器在 ValidationPipe 中生效，此处为纵深防御
    if (!body?.logs || !Array.isArray(body.logs) || body.logs.length === 0) {
      throw new BusinessValidationException('logs 不能为空');
    }
    if (body.logs.length > 50) {
      throw new BusinessValidationException('单次批量日志不能超过 50 条');
    }
    const userId = req.user?.id || 'system';
    const userName = req.user?.name || req.user?.username || 'system';
    for (const log of body.logs) {
      if (!log.message || typeof log.message !== 'string') continue;
      await this.logs.create({
        userId,
        userName,
        action: `[${(log.level || 'info').toUpperCase()}] ${log.message.slice(0, 500)}`,
        target: log.url ? log.url.slice(0, 500) : undefined,
        detail: JSON.stringify({
          stack: log.stack ? log.stack.slice(0, 2000) : undefined,
          context: log.context ? log.context.slice(0, 500) : undefined,
          userAgent: log.userAgent ? log.userAgent.slice(0, 500) : undefined,
        }),
      });
    }
    return { success: true };
  }
}
