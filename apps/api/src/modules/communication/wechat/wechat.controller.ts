import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { WechatService } from './wechat.service';
import { SendWechatDto, SendBatchWechatDto } from './dto/send-wechat.dto';
import { QueryWechatDto } from './dto/query-wechat.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.RECEPTIONIST)
@ApiTags('微信消息')
@Controller('wechat')
export class WechatController {
  constructor(private wechat: WechatService) {}

  @Get()
  findMany(
    @Query() q: QueryWechatDto,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    return this.wechat.findMany(q, safePage(page), safePageSize(pageSize, 20));
  }

  @Get('birthday-patients')
  getBirthdayPatients() {
    return this.wechat.getBirthdayPatients();
  }

  @Get('appointment-reminders')
  getAppointmentReminders() {
    return this.wechat.getAppointmentReminders();
  }

  @Post('send')
  send(@Body() dto: SendWechatDto) {
    return this.wechat.send(dto);
  }

  @Post('send-batch')
  sendBatch(@Body() dto: SendBatchWechatDto) {
    return this.wechat.sendBatch(dto);
  }
}
