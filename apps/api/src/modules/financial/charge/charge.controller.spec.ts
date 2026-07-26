import { Test, TestingModule } from '@nestjs/testing';
import { ChargeController } from './charge.controller';
import { ChargeService } from './charge.service';
import { ChargePaymentService } from './charge-payment.service';
import { DebtService } from './debt.service';
import { ComboService } from './combo.service';
import { PaymentMethodService } from './payment-method.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';

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

  // ==================== 收费组合 ====================
  describe('listCombos', () => {
    it('调用 comboService.listCombos 传入 req.user.id', async () => {
      const expected = [{ id: 'cb-1', name: '常规套餐' }];
      comboService.listCombos.mockResolvedValue(expected);

      const result = await controller.listCombos({ user: { id: 'u-1' } } as any);
      expect(result).toEqual(expected);
      expect(comboService.listCombos).toHaveBeenCalledWith('u-1');
    });
  });

  describe('createCombo', () => {
    it('调用 comboService.createCombo 传入 dto 和 userId', async () => {
      const dto = { name: '常规套餐', items: [] };
      comboService.createCombo.mockResolvedValue({ id: 'cb-1', ...dto });

      const result = await controller.createCombo(dto, { user: { id: 'u-1' } } as any);
      expect(result).toEqual({ id: 'cb-1', ...dto });
      expect(comboService.createCombo).toHaveBeenCalledWith(dto, 'u-1');
    });
  });

  describe('updateCombo', () => {
    it('调用 comboService.updateCombo 传入 id 和 dto', async () => {
      const dto = { name: '更新套餐' };
      comboService.updateCombo.mockResolvedValue({ id: 'cb-1', ...dto });

      const result = await controller.updateCombo('cb-1', dto);
      expect(result).toEqual({ id: 'cb-1', ...dto });
      expect(comboService.updateCombo).toHaveBeenCalledWith('cb-1', dto);
    });
  });

  describe('deleteCombo', () => {
    it('调用 comboService.deleteCombo 传入 id', async () => {
      comboService.deleteCombo.mockResolvedValue({ id: 'cb-1' });
      const result = await controller.deleteCombo('cb-1');
      expect(result).toEqual({ id: 'cb-1' });
      expect(comboService.deleteCombo).toHaveBeenCalledWith('cb-1');
    });
  });

  // ==================== 缴费方式 ====================
  describe('listPaymentMethods', () => {
    it('调用 paymentMethodService.listPaymentMethods', async () => {
      const expected = [{ id: 'pm-1', name: '现金' }];
      paymentMethodService.listPaymentMethods.mockResolvedValue(expected);

      const result = await controller.listPaymentMethods();
      expect(result).toEqual(expected);
      expect(paymentMethodService.listPaymentMethods).toHaveBeenCalledWith();
    });
  });

  describe('createPaymentMethod', () => {
    it('调用 paymentMethodService.createPaymentMethod 传入 dto', async () => {
      const dto = { name: '微信支付' };
      paymentMethodService.createPaymentMethod.mockResolvedValue({ id: 'pm-2', ...dto });

      const result = await controller.createPaymentMethod(dto as any);
      expect(result).toEqual({ id: 'pm-2', ...dto });
      expect(paymentMethodService.createPaymentMethod).toHaveBeenCalledWith(dto);
    });
  });

  describe('updatePaymentMethod', () => {
    it('调用 paymentMethodService.updatePaymentMethod 传入 id 和 dto', async () => {
      const dto = { name: '支付宝' };
      paymentMethodService.updatePaymentMethod.mockResolvedValue({ id: 'pm-1', ...dto });

      const result = await controller.updatePaymentMethod('pm-1', dto);
      expect(result).toEqual({ id: 'pm-1', ...dto });
      expect(paymentMethodService.updatePaymentMethod).toHaveBeenCalledWith('pm-1', dto);
    });
  });

  describe('deletePaymentMethod', () => {
    it('调用 paymentMethodService.deletePaymentMethod 传入 id', async () => {
      paymentMethodService.deletePaymentMethod.mockResolvedValue({ id: 'pm-1' });
      const result = await controller.deletePaymentMethod('pm-1');
      expect(result).toEqual({ id: 'pm-1' });
      expect(paymentMethodService.deletePaymentMethod).toHaveBeenCalledWith('pm-1');
    });
  });

  describe('togglePaymentMethod', () => {
    it('调用 paymentMethodService.togglePaymentMethod 传入 id', async () => {
      paymentMethodService.togglePaymentMethod.mockResolvedValue({ id: 'pm-1', active: false });
      const result = await controller.togglePaymentMethod('pm-1');
      expect(result).toEqual({ id: 'pm-1', active: false });
      expect(paymentMethodService.togglePaymentMethod).toHaveBeenCalledWith('pm-1');
    });
  });

  // ==================== 欠费管理 ====================
  describe('listDebts', () => {
    it('调用 debtService.listDebts 传入 dto', async () => {
      const expected = { items: [], total: 0 };
      debtService.listDebts.mockResolvedValue(expected);
      const dto = { patientId: 'p-1', status: 'UNPAID' } as any;

      const result = await controller.listDebts(dto);
      expect(result).toEqual(expected);
      expect(debtService.listDebts).toHaveBeenCalledWith(dto);
    });
  });

  describe('debtStats', () => {
    it('调用 debtService.debtStats', async () => {
      const expected = { total: 100, paid: 80, unpaid: 20 };
      debtService.debtStats.mockResolvedValue(expected);

      const result = await controller.debtStats();
      expect(result).toEqual(expected);
      expect(debtService.debtStats).toHaveBeenCalledWith();
    });
  });

  describe('getDebt', () => {
    it('调用 debtService.getDebt 传入 id', async () => {
      const expected = { id: 'd-1', amount: 100 };
      debtService.getDebt.mockResolvedValue(expected);

      const result = await controller.getDebt('d-1');
      expect(result).toEqual(expected);
      expect(debtService.getDebt).toHaveBeenCalledWith('d-1');
    });

    it('不存在时透传 NotFoundException', async () => {
      debtService.getDebt.mockRejectedValue(new NotFoundException('Debt不存在'));
      await expect(controller.getDebt('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('createDebtFromCharge', () => {
    it('调用 debtService.createDebtFromCharge 传入 dto', async () => {
      const dto = { chargeId: 'c-1', amount: 100 };
      debtService.createDebtFromCharge.mockResolvedValue({ id: 'd-1', ...dto });

      const result = await controller.createDebtFromCharge(dto as any);
      expect(result).toEqual({ id: 'd-1', ...dto });
      expect(debtService.createDebtFromCharge).toHaveBeenCalledWith(dto);
    });
  });

  describe('payDebt', () => {
    it('调用 debtService.payDebt 传入 id/dto/userId', async () => {
      const dto = { amount: 50, paymentMethod: 'CASH' };
      debtService.payDebt.mockResolvedValue({ id: 'd-1', paidAmount: 50 });

      const result = await controller.payDebt('d-1', dto, { user: { id: 'u-1' } } as any);
      expect(result).toEqual({ id: 'd-1', paidAmount: 50 });
      expect(debtService.payDebt).toHaveBeenCalledWith('d-1', dto, 'u-1');
    });
  });

  // ==================== 收费 ====================
  describe('listCharges', () => {
    it('调用 chargeService.listCharges 传入 q', async () => {
      const expected = { items: [], total: 0 };
      chargeService.listCharges.mockResolvedValue(expected);
      const q = { page: '1', pageSize: '20' };

      const result = await controller.listCharges(q as any);
      expect(result).toEqual(expected);
      expect(chargeService.listCharges).toHaveBeenCalledWith(q);
    });
  });

  describe('createCharge', () => {
    it('调用 chargeService.createCharge 传入 dto', async () => {
      const dto = { patientId: 'p-1', items: [] };
      chargeService.createCharge.mockResolvedValue({ id: 'c-1', ...dto });

      const result = await controller.createCharge(dto);
      expect(result).toEqual({ id: 'c-1', ...dto });
      expect(chargeService.createCharge).toHaveBeenCalledWith(dto);
    });

    it('参数错误时透传 BadRequestException', async () => {
      chargeService.createCharge.mockRejectedValue(new BadRequestException('金额错误'));
      await expect(controller.createCharge({} as any)).rejects.toThrow(BadRequestException);
    });
  });

  describe('getCharge', () => {
    it('调用 chargeService.getCharge 传入 id', async () => {
      const expected = { id: 'c-1', totalAmount: 100 };
      chargeService.getCharge.mockResolvedValue(expected);

      const result = await controller.getCharge('c-1');
      expect(result).toEqual(expected);
      expect(chargeService.getCharge).toHaveBeenCalledWith('c-1');
    });
  });

  describe('payCharge', () => {
    it('调用 chargePaymentService.payCharge 传入 id/dto/userId', async () => {
      const dto = { paymentMethod: 'CASH', amount: 100 };
      chargePaymentService.payCharge.mockResolvedValue({ id: 'c-1', status: 'PAID' });

      const result = await controller.payCharge('c-1', dto, { user: { id: 'u-1' } } as any);
      expect(result).toEqual({ id: 'c-1', status: 'PAID' });
      expect(chargePaymentService.payCharge).toHaveBeenCalledWith('c-1', dto, 'u-1');
    });
  });
});
