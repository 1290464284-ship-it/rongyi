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
  } from '@nestjs/common';
import { Request as ExpressRequest } from 'express';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { Role } from '@dental/shared';
import { Roles } from '../../../common/decorators/roles.decorator';
import { OperationLogResource } from '../../../common/decorators/operation-log-resource.decorator';
import { ChargeService } from './charge.service';
import { ChargePaymentService } from './charge-payment.service';
import { DebtService } from './debt.service';
import { ComboService } from './combo.service';
import { PaymentMethodService } from './payment-method.service';
import { CreateComboDto, UpdateComboDto } from './dto/combo.dto';
import { CreatePaymentMethodDto, UpdatePaymentMethodDto } from './dto/payment-method.dto';
import { QueryDebtDto, CreateDebtFromChargeDto, PayDebtDto } from './dto/debt.dto';
import { CreateChargeDto, QueryChargesDto } from './dto/create-charge.dto';
import { PayChargeDto } from './dto/pay-charge.dto';

@Roles(Role.BOSS, Role.RECEPTIONIST, Role.DOCTOR)
@ApiTags('收费管理')
@OperationLogResource('收费')
@Controller('charge-v2')
export class ChargeController {
  constructor(
    private chargeService: ChargeService,
    private chargePaymentService: ChargePaymentService,
    private debtService: DebtService,
    private comboService: ComboService,
    private paymentMethodService: PaymentMethodService,
  ) {}

  // ==================== 收费组合 ====================

  @ApiOperation({ summary: '查询收费组合列表' })
  @Get('combos')
  listCombos(@Request() req: ExpressRequest) {
    return this.comboService.listCombos(req.user?.id);
  }

  @ApiOperation({ summary: '创建收费组合' })
  @Post('combos')
  createCombo(@Body() dto: CreateComboDto, @Request() req: ExpressRequest) {
    return this.comboService.createCombo(dto, req.user?.id);
  }

  @ApiOperation({ summary: '更新收费组合' })
  @Patch('combos/:id')
  updateCombo(@Param('id') id: string, @Body() dto: UpdateComboDto) {
    return this.comboService.updateCombo(id, dto);
  }

  @ApiOperation({ summary: '删除收费组合' })
  @Delete('combos/:id')
  deleteCombo(@Param('id') id: string) {
    return this.comboService.deleteCombo(id);
  }

  // ==================== 缴费方式 ====================

  @ApiOperation({ summary: '查询缴费方式列表' })
  @Get('payment-methods')
  listPaymentMethods() {
    return this.paymentMethodService.listPaymentMethods();
  }

  @ApiOperation({ summary: '创建缴费方式' })
  @Post('payment-methods')
  createPaymentMethod(@Body() dto: CreatePaymentMethodDto) {
    return this.paymentMethodService.createPaymentMethod(dto);
  }

  @ApiOperation({ summary: '更新缴费方式' })
  @Patch('payment-methods/:id')
  updatePaymentMethod(@Param('id') id: string, @Body() dto: UpdatePaymentMethodDto) {
    return this.paymentMethodService.updatePaymentMethod(id, dto);
  }

  @ApiOperation({ summary: '删除缴费方式' })
  @Delete('payment-methods/:id')
  deletePaymentMethod(@Param('id') id: string) {
    return this.paymentMethodService.deletePaymentMethod(id);
  }

  @ApiOperation({ summary: 'togglePaymentMethod - 收费' })
  @Patch('payment-methods/:id/toggle')
  togglePaymentMethod(@Param('id') id: string) {
    return this.paymentMethodService.togglePaymentMethod(id);
  }

  // ==================== 欠费管理 ====================

  @ApiOperation({ summary: '查询欠费列表' })
  @Get('debts')
  listDebts(@Query() dto: QueryDebtDto) {
    return this.debtService.listDebts(dto);
  }

  @ApiOperation({ summary: 'debtStats - 收费' })
  @Get('debts/stats')
  debtStats() {
    return this.debtService.debtStats();
  }

  @ApiOperation({ summary: '获取欠费详情' })
  @Get('debts/:id')
  getDebt(@Param('id') id: string) {
    return this.debtService.getDebt(id);
  }

  @ApiOperation({ summary: '从收费单创建欠费' })
  @Post('debts/from-charge')
  createDebtFromCharge(@Body() dto: CreateDebtFromChargeDto) {
    return this.debtService.createDebtFromCharge(dto);
  }

  @ApiOperation({ summary: '结清欠费' })
  @Post('debts/:id/pay')
  @HttpCode(200)
  payDebt(@Param('id') id: string, @Body() dto: PayDebtDto, @Request() req: ExpressRequest) {
    return this.debtService.payDebt(id, dto, req.user?.id);
  }

  // ==================== 收费 ====================

  @ApiOperation({ summary: '查询收费单列表' })
  @Get()
  listCharges(@Query() q: QueryChargesDto) {
    return this.chargeService.listCharges(q);
  }

  @ApiOperation({ summary: '创建收费单' })
  @Post()
  createCharge(@Body() dto: CreateChargeDto) {
    return this.chargeService.createCharge(dto);
  }

  @ApiOperation({ summary: '获取收费单详情' })
  @Get(':id')
  getCharge(@Param('id') id: string) {
    return this.chargeService.getCharge(id);
  }

  @ApiOperation({ summary: 'payCharge - 收费' })
  @Patch(':id/pay')
  payCharge(@Param('id') id: string, @Body() dto: PayChargeDto, @Request() req: ExpressRequest) {
    return this.chargePaymentService.payCharge(id, dto, req.user?.id);
  }
}
