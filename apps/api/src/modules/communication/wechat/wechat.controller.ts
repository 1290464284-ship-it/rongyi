import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { WechatService } from './wechat.service';
import { SendWechatDto, SendBatchWechatDto } from './dto/send-wechat.dto';
import { QueryWechatDto } from './dto/query-wechat.dto';

@Roles(Role.BOSS, Role.RECEPTIONIST)
@ApiTags('微信消息')
@OperationLogResource('微信')
@Controller('wechat')
export class WechatController {
  constructor(private wechat: WechatService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(
    @Query() q: QueryWechatDto,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.wechat.findMany(q, safePage(page), safePageSize(pageSize, 20));
  }

  @ApiOperation({ summary: '获取微信' })
  @Get('birthday-patients')
  getBirthdayPatients() {
    return this.wechat.getBirthdayPatients();
  }

  @ApiOperation({ summary: '获取微信' })
  @Get('appointment-reminders')
  getAppointmentReminders() {
    return this.wechat.getAppointmentReminders();
  }

  @ApiOperation({ summary: '发送微信' })
  @Post('send')
  send(@Body() dto: SendWechatDto) {
    return this.wechat.send(dto);
  }

  @ApiOperation({ summary: '发送微信' })
  @Post('send-batch')
  sendBatch(@Body() dto: SendBatchWechatDto) {
    return this.wechat.sendBatch(dto);
  }
}
