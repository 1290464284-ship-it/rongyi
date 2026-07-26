import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { MemberCardsService } from './member-cards.service';
import { RechargeDto } from './dto/recharge.dto';
import { AddPointsDto, DeductPointsDto, ConsumeDto, RefundDto } from './dto/member-card-ops.dto';

@Roles(Role.BOSS, Role.RECEPTIONIST)
@ApiTags('会员卡管理')
@OperationLogResource('会员卡')
@Controller('member-cards')
export class MemberCardsController {
  constructor(private cards: MemberCardsService) {}

  @ApiOperation({ summary: '分页查询列表' })
  @Get()
  findMany(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.cards.findMany({ page: safePage(page), pageSize: safePageSize(pageSize, 20) });
  }

  @ApiOperation({ summary: '按条件查询会员卡' })
  @Get('patient/:patientId')
  findByPatient(@Param('patientId') patientId: string) {
    return this.cards.findByPatient(patientId);
  }

  @ApiOperation({ summary: '获取操作日志' })
  @Get(':id/logs')
  getLogs(@Param('id') id: string) {
    return this.cards.getLogs(id);
  }

  @ApiOperation({ summary: '创建会员卡' })
  @Post('patient/:patientId')
  createForPatient(@Param('patientId') patientId: string) {
    return this.cards.createForPatient(patientId);
  }

  @ApiOperation({ summary: '充值' })
  @Post(':id/recharge')
  recharge(@Param('id') id: string, @Body() dto: RechargeDto) {
    return this.cards.recharge(id, dto.amount);
  }

  @ApiOperation({ summary: '获取会员卡' })
  @Get(':id/point-logs')
  findPointLogs(@Param('id') id: string) {
    return this.cards.findPointLogs(id);
  }

  @ApiOperation({ summary: '创建会员卡' })
  @Post(':id/points')
  addPoints(
    @Param('id') id: string,
    @Body() dto: AddPointsDto,
  ) {
    return this.cards.addPoints(id, dto.points, dto.chargeId, dto.remark);
  }

  @ApiOperation({ summary: 'deductPoints - 会员卡' })
  @Post(':id/points/deduct')
  deductPoints(
    @Param('id') id: string,
    @Body() dto: DeductPointsDto,
  ) {
    return this.cards.deductPoints(id, dto.points, dto.remark);
  }

  @ApiOperation({ summary: '消费' })
  @Post(':id/consume')
  consume(
    @Param('id') id: string,
    @Body() dto: ConsumeDto,
  ) {
    return this.cards.consume(id, dto.amount, dto.chargeId, dto.remark);
  }

  @ApiOperation({ summary: '退款' })
  @Post(':id/refund')
  refund(
    @Param('id') id: string,
    @Body() dto: RefundDto,
  ) {
    return this.cards.refund(id, dto.amount, dto.chargeId, dto.remark);
  }
}
