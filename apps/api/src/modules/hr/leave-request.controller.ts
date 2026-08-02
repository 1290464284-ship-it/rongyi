import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { ROLES } from '@dental/shared';
import { Roles } from '../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../common/decorators/operation-log-resource.decorator';
import { LeaveRequestService } from './leave-request.service';
import { CreateLeaveRequestDto } from './dto/create-leave-request.dto';
import { ListLeaveRequestDto } from './dto/list-leave-request.dto';
import { RejectLeaveDto } from './dto/reject-leave.dto';
import { SubmitLeaveDto } from './dto/submit-leave.dto';
import { ApproveLeaveDto } from './dto/approve-leave.dto';

@Roles(ROLES.BOSS, ROLES.DOCTOR, ROLES.RECEPTIONIST, ROLES.ADMIN)
@ApiTags('HR 请假申请')
@OperationLogResource('LeaveRequest')
@Controller('hr/leaves')
export class LeaveRequestController {
  constructor(private leaveRequestService: LeaveRequestService) {}

  @ApiOperation({ summary: '查询请假列表' })
  @Get()
  list(@Query() query: ListLeaveRequestDto) {
    return this.leaveRequestService.list(query);
  }

  @ApiOperation({ summary: '创建请假申请（SAVED 状态）' })
  @Post()
  create(@Body() dto: CreateLeaveRequestDto) {
    return this.leaveRequestService.create(dto);
  }

  @ApiOperation({ summary: '提交请假申请（SAVED → PENDING）' })
  @Post(':id/submit')
  submit(@Param('id') id: string, @Body() _dto: SubmitLeaveDto) {
    return this.leaveRequestService.submit(id);
  }

  @ApiOperation({ summary: '审批通过（PENDING → APPROVED）' })
  @Post(':id/approve')
  approve(@Param('id') id: string, @Body() _dto: ApproveLeaveDto) {
    return this.leaveRequestService.approve(id);
  }

  @ApiOperation({ summary: '审批拒绝（PENDING → REJECTED）' })
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectLeaveDto) {
    return this.leaveRequestService.reject(id, dto.rejectReason);
  }

  @ApiOperation({ summary: '取消请假（SAVED/PENDING → CANCELLED）' })
  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.leaveRequestService.cancel(id);
  }
}
