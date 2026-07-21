import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { Role } from '../../../common/types/enums';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { ChargeV2Service } from './charge-v2.service';
import { CreateComboDto, UpdateComboDto } from './dto/combo.dto';
import { CreatePaymentMethodDto, UpdatePaymentMethodDto } from './dto/payment-method.dto';
import { QueryDebtDto, CreateDebtFromChargeDto, PayDebtDto } from './dto/debt.dto';
import { CreateChargeDto } from './dto/create-charge.dto';
import { PayChargeDto } from './dto/pay-charge.dto';

@UseGuards(JwtAuthGuard)
@Roles(Role.BOSS, Role.RECEPTIONIST, Role.DOCTOR)
@ApiTags('收费管理')
@Controller('charge-v2')
export class ChargeV2Controller {
  constructor(private chargeV2: ChargeV2Service) {}

  // ==================== 收费组合 ====================

  @Get('combos')
  listCombos(@Request() req: ExpressRequest) {
    return this.chargeV2.listCombos(req.user?.id);
  }

  @Post('combos')
  createCombo(@Body() dto: CreateComboDto, @Request() req: ExpressRequest) {
    return this.chargeV2.createCombo(dto, req.user?.id);
  }

  @Patch('combos/:id')
  updateCombo(@Param('id') id: string, @Body() dto: UpdateComboDto) {
    return this.chargeV2.updateCombo(id, dto);
  }

  @Delete('combos/:id')
  deleteCombo(@Param('id') id: string) {
    return this.chargeV2.deleteCombo(id);
  }

  // ==================== 缴费方式 ====================

  @Get('payment-methods')
  listPaymentMethods() {
    return this.chargeV2.listPaymentMethods();
  }

  @Post('payment-methods')
  createPaymentMethod(@Body() dto: CreatePaymentMethodDto) {
    return this.chargeV2.createPaymentMethod(dto);
  }

  @Patch('payment-methods/:id')
  updatePaymentMethod(@Param('id') id: string, @Body() dto: UpdatePaymentMethodDto) {
    return this.chargeV2.updatePaymentMethod(id, dto);
  }

  @Delete('payment-methods/:id')
  deletePaymentMethod(@Param('id') id: string) {
    return this.chargeV2.deletePaymentMethod(id);
  }

  @Patch('payment-methods/:id/toggle')
  togglePaymentMethod(@Param('id') id: string) {
    return this.chargeV2.togglePaymentMethod(id);
  }

  // ==================== 欠费管理 ====================

  @Get('debts')
  listDebts(@Query() dto: QueryDebtDto) {
    return this.chargeV2.listDebts(dto);
  }

  @Get('debts/stats')
  debtStats() {
    return this.chargeV2.debtStats();
  }

  @Get('debts/:id')
  getDebt(@Param('id') id: string) {
    return this.chargeV2.getDebt(id);
  }

  @Post('debts/from-charge')
  createDebtFromCharge(@Body() dto: CreateDebtFromChargeDto) {
    return this.chargeV2.createDebtFromCharge(dto);
  }

  @Post('debts/:id/pay')
  @HttpCode(200)
  payDebt(@Param('id') id: string, @Body() dto: PayDebtDto, @Request() req: ExpressRequest) {
    return this.chargeV2.payDebt(id, dto, req.user?.id);
  }

  // ==================== 收费 ====================

  @Get()
  listCharges(@Query() q: { page?: string | number; pageSize?: string | number }) {
    return this.chargeV2.listCharges(q);
  }

  @Post()
  createCharge(@Body() dto: CreateChargeDto) {
    return this.chargeV2.createCharge(dto);
  }

  @Get(':id')
  getCharge(@Param('id') id: string) {
    return this.chargeV2.getCharge(id);
  }

  @Patch(':id/pay')
  payCharge(@Param('id') id: string, @Body() dto: PayChargeDto, @Request() req: ExpressRequest) {
    return this.chargeV2.payCharge(id, dto, req.user?.id);
  }
}
