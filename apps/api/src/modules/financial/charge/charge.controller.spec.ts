import { Test, TestingModule } from '@nestjs/testing';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';

import { Request } from 'express';
import { ChargeController } from './charge.controller';
import { ChargeService } from './charge.service';
import { ChargePaymentService } from './charge-payment.service';
import { DebtService } from './debt.service';
import { ComboService } from './combo.service';
import { PaymentMethodService } from './payment-method.service';
import { CreatePaymentMethodDto } from './dto/payment-method.dto';
import { QueryDebtDto, PayDebtDto, CreateDebtFromChargeDto } from './dto/debt.dto';
import { QueryChargesDto, CreateChargeDto } from './dto/create-charge.dto';
import { PayChargeDto } from './dto/pay-charge.dto';

describe('ChargeController', () => {
  let controller: ChargeController;
  let chargeService: { [key: string]: jest.Mock };
  let chargePaymentService: { [key: string]: jest.Mock };
  let debtService: { [key: string]: jest.Mock };
  let comboService: { [key: string]: jest.Mock };
  let paymentMethodService: { [key: string]: jest.Mock };

  beforeEach(async () => {
    chargeService = {
      listCharges: jest.fn(),
      createCharge: jest.fn(),
      getCharge: jest.fn(),
    };
    chargePaymentService = { payCharge: jest.fn() };
    debtService = {
      listDebts: jest.fn(),
      debtStats: jest.fn(),
      getDebt: jest.fn(),
      createDebtFromCharge: jest.fn(),
      payDebt: jest.fn(),
    };
    comboService = {
      listCombos: jest.fn(),
      createCombo: jest.fn(),
      updateCombo: jest.fn(),
      deleteCombo: jest.fn(),
    };
    paymentMethodService = {
      listPaymentMethods: jest.fn(),
      createPaymentMethod: jest.fn(),
      updatePaymentMethod: jest.fn(),
      deletePaymentMethod: jest.fn(),
      togglePaymentMethod: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ChargeController],
      providers: [
        { provide: ChargeService, useValue: chargeService },
        { provide: ChargePaymentService, useValue: chargePaymentService },
        { provide: DebtService, useValue: debtService },
        { provide: ComboService, useValue: comboService },
        { provide: PaymentMethodService, useValue: paymentMethodService },
      ],
    }).compile();

    controller = module.get(ChargeController);
  });

  describe('listCombos / createCombo - 收费组合', () => {
    it('从请求中提取 userId 传递给 listCombos', async () => {
      comboService.listCombos.mockResolvedValue([]);
      const req = { user: { id: 'u-1' } } as unknown as Request;

      await controller.listCombos(req);
      expect(comboService.listCombos).toHaveBeenCalledWith('u-1');
    });

    it('userId 为 undefined 时也能正常处理', async () => {
      comboService.listCombos.mockResolvedValue([]);
      const req = { user: {} } as unknown as Request;

      await controller.listCombos(req);
      expect(comboService.listCombos).toHaveBeenCalledWith(undefined);
    });

    it('createCombo 传递 dto 和 userId', async () => {
      const dto = { name: '常规套餐', items: [] };
      comboService.createCombo.mockResolvedValue({ id: 'cb-1' });
      const req = { user: { id: 'u-1' } } as unknown as Request;

      await controller.createCombo(dto, req);
      expect(comboService.createCombo).toHaveBeenCalledWith(dto, 'u-1');
    });

    it('updateCombo 和 deleteCombo 正常透传', async () => {
      comboService.updateCombo.mockResolvedValue({ id: 'cb-1' });
      comboService.deleteCombo.mockResolvedValue({ id: 'cb-1' });

      await controller.updateCombo('cb-1', { name: '更新' });
      expect(comboService.updateCombo).toHaveBeenCalledWith('cb-1', { name: '更新' });

      await controller.deleteCombo('cb-1');
      expect(comboService.deleteCombo).toHaveBeenCalledWith('cb-1');
    });
  });

  describe('缴费方式', () => {
    it('listPaymentMethods 和 createPaymentMethod 正常调用', async () => {
      paymentMethodService.listPaymentMethods.mockResolvedValue([]);
      paymentMethodService.createPaymentMethod.mockResolvedValue({ id: 'pm-1' });

      await controller.listPaymentMethods();
      expect(paymentMethodService.listPaymentMethods).toHaveBeenCalled();

      const dto: CreatePaymentMethodDto = { name: '微信支付', code: 'WECHAT' };
      await controller.createPaymentMethod(dto);
      expect(paymentMethodService.createPaymentMethod).toHaveBeenCalledWith(dto);
    });

    it('togglePaymentMethod 切换激活状态', async () => {
      paymentMethodService.togglePaymentMethod.mockResolvedValue({ id: 'pm-1', active: false });

      const result = await controller.togglePaymentMethod('pm-1');
      expect(result).toEqual({ id: 'pm-1', active: false });
    });
  });

  describe('欠费管理', () => {
    it('listDebts 透传查询参数', async () => {
      const dto: QueryDebtDto = { patientId: 'p-1', status: 'UNPAID' } as QueryDebtDto;
      debtService.listDebts.mockResolvedValue({ items: [], total: 0 });

      await controller.listDebts(dto);
      expect(debtService.listDebts).toHaveBeenCalledWith(dto);
    });

    it('getDebt 不存在时透传 BusinessNotFoundException', async () => {
      debtService.getDebt.mockRejectedValue(new BusinessNotFoundException('欠费不存在'));

      await expect(controller.getDebt('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });

    it('payDebt 传递 userId 用于操作审计', async () => {
      const dto: PayDebtDto = { amount: 50, payMethod: 'CASH' };
      debtService.payDebt.mockResolvedValue({ id: 'd-1', paidAmount: 50 });
      const req = { user: { id: 'u-1' } } as unknown as Request;

      await controller.payDebt('d-1', dto, req);
      expect(debtService.payDebt).toHaveBeenCalledWith('d-1', dto, 'u-1');
    });

    it('createDebtFromCharge 从收费单创建欠费', async () => {
      const dto = { chargeId: 'c-1', amount: 100 };
      debtService.createDebtFromCharge.mockResolvedValue({ id: 'd-1' });

      await controller.createDebtFromCharge(dto as unknown as CreateDebtFromChargeDto);
      expect(debtService.createDebtFromCharge).toHaveBeenCalledWith(dto);
    });
  });

  describe('收费', () => {
    it('listCharges 透传查询参数', async () => {
      const q = { page: '1', pageSize: '20' };
      chargeService.listCharges.mockResolvedValue({ items: [], total: 0 });

      await controller.listCharges(q as unknown as QueryChargesDto);
      expect(chargeService.listCharges).toHaveBeenCalledWith(q);
    });

    it('createCharge 参数错误时透传 BusinessValidationException', async () => {
      chargeService.createCharge.mockRejectedValue(new BusinessValidationException('金额错误'));

      await expect(controller.createCharge({} as unknown as CreateChargeDto)).rejects.toThrow(BusinessValidationException);
    });

    it('payCharge 传递 userId 用于操作审计', async () => {
      const dto: PayChargeDto = { amount: 100, payMethod: 'CASH' };
      chargePaymentService.payCharge.mockResolvedValue({ id: 'c-1', status: 'PAID' });
      const req = { user: { id: 'u-1' } } as unknown as Request;

      await controller.payCharge('c-1', dto, req);
      expect(chargePaymentService.payCharge).toHaveBeenCalledWith('c-1', dto, 'u-1');
    });

    it('getCharge 不存在时透传 BusinessNotFoundException', async () => {
      chargeService.getCharge.mockRejectedValue(new BusinessNotFoundException('收费单不存在'));

      await expect(controller.getCharge('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });
});