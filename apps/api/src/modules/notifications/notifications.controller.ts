import { Controller, Get, Post, Delete, Param, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { NotificationsService } from './notifications.service';
import { QueryNotificationDto } from './dto/notification.dto';
import { safePage, safePageSize } from '../../common/dto/pagination.dto';
import { Notification, UnreadCountResult } from './types/notification.types';
import { Role } from '@dental/shared';
import { Roles } from '../../common/decorators/roles.decorator';

@ApiTags('通知')
@Roles(Role.BOSS, Role.DOCTOR, Role.RECEPTIONIST)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  @ApiOperation({ summary: '分页获取当前用户通知列表' })
  @ApiQuery({ name: 'page', required: false, description: '页码，默认 1' })
  @ApiQuery({ name: 'pageSize', required: false, description: '每页条数，默认 20' })
  @ApiResponse({ status: 200, description: '通知列表' })
  findMany(
    @Query() q: QueryNotificationDto,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ): Promise<{
    items: Notification[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return this.notificationsService.findMany({
      type: q.type,
      priority: q.priority,
      isRead: q.isRead,
      keyword: q.keyword,
      page: safePage(page),
      pageSize: safePageSize(pageSize, 20),
    });
  }

  @ApiOperation({ summary: '统计通知数量' })
  @Get('unread-count')
  @ApiOperation({ summary: '获取未读通知数量' })
  @ApiResponse({ status: 200, description: '未读统计结果' })
  getUnreadCount(): Promise<UnreadCountResult> {
    return this.notificationsService.getUnreadCount();
  }

  @ApiOperation({ summary: '获取详情' })
  @Get(':id')
  @ApiOperation({ summary: '获取单条通知详情' })
  @ApiResponse({ status: 200, description: '通知详情' })
  @ApiResponse({ status: 404, description: '通知不存在' })
  findOne(@Param('id') id: string): Promise<Notification> {
    return this.notificationsService.findOne(id);
  }

  @ApiOperation({ summary: 'markAsRead - 通知' })
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '标记单条通知为已读' })
  @ApiResponse({ status: 200, description: '标记成功' })
  @ApiResponse({ status: 404, description: '通知不存在' })
  markAsRead(@Param('id') id: string): Promise<Notification> {
    return this.notificationsService.markAsRead(id);
  }

  @ApiOperation({ summary: 'markAllAsRead - 通知' })
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '标记所有通知为已读' })
  @ApiResponse({ status: 200, description: '标记成功' })
  markAllAsRead(): Promise<{ count: number }> {
    return this.notificationsService.markAllAsRead();
  }

  @ApiOperation({ summary: '删除' })
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除通知（软删除）' })
  @ApiResponse({ status: 204, description: '删除成功' })
  @ApiResponse({ status: 404, description: '通知不存在' })
  remove(@Param('id') id: string): Promise<void> {
    return this.notificationsService.remove(id);
  }
}
