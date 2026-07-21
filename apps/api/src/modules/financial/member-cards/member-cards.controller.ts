import { safePage, safePageSize } from '../../../common/dto/pagination.dto';
import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { MemberCardsService } from './member-cards.service';
import { RechargeDto } from './dto/recharge.dto';
import { AddPointsDto, DeductPointsDto, ConsumeDto, RefundDto } from './dto/member-card-ops.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.RECEPTIONIST)
@ApiTags('会员卡管理')
@Controller('member-cards')
export class MemberCardsController {
  constructor(private cards: MemberCardsService) {}

  @Get()
  findMany(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.cards.findMany({ page: safePage(page), pageSize: safePageSize(pageSize, 20) });
  }

  @Get('patient/:patientId')
  findByPatient(@Param('patientId') patientId: string) {
    return this.cards.findByPatient(patientId);
  }

  @Get(':id/logs')
  getLogs(@Param('id') id: string) {
    return this.cards.getLogs(id);
  }

  @Post('patient/:patientId')
  createForPatient(@Param('patientId') patientId: string) {
    return this.cards.createForPatient(patientId);
  }

  @Post(':id/recharge')
  recharge(@Param('id') id: string, @Body() dto: RechargeDto) {
    return this.cards.recharge(id, dto.amount);
  }

  @Get(':id/point-logs')
  findPointLogs(@Param('id') id: string) {
    return this.cards.findPointLogs(id);
  }

  @Post(':id/points')
  addPoints(
    @Param('id') id: string,
    @Body() dto: AddPointsDto,
  ) {
    return this.cards.addPoints(id, dto.points, dto.chargeId, dto.remark);
  }

  @Post(':id/points/deduct')
  deductPoints(
    @Param('id') id: string,
    @Body() dto: DeductPointsDto,
  ) {
    return this.cards.deductPoints(id, dto.points, dto.remark);
  }

  @Post(':id/consume')
  consume(
    @Param('id') id: string,
    @Body() dto: ConsumeDto,
  ) {
    return this.cards.consume(id, dto.amount, dto.chargeId, dto.remark);
  }

  @Post(':id/refund')
  refund(
    @Param('id') id: string,
    @Body() dto: RefundDto,
  ) {
    return this.cards.refund(id, dto.amount, dto.chargeId, dto.remark);
  }
}
