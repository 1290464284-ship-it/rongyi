import { ChargeV2Service, CreateChargeDto, PayChargeDto } from './charge-v2.service';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('ChargeV2Service', () => {
  let service: ChargeV2Service;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new ChargeV2Service(db as any);
  });

  afterEach(() => {
    db.clear();
  });

  // ==================== createCharge ====================

  describe('createCharge', () => {
    it('正常创建收费单，总金额为各项目小计之和', async () => {
      const patientId = 'patient-001';
      const dto: CreateChargeDto = {
        patientId,
        items: [
          { name: '洗牙', price: 100, quantity: 1 },
          { name: '补牙', price: 200, quantity: 2 },
        ],
      };

      const result = await service.createCharge(dto);

      expect(result.id).toBeDefined();
      expect(result.patientId).toBe(patientId);
      expect(result.totalAmount).toBe(100 * 1 + 200 * 2); // 500
      expect(result.status).toBe('UNPAID');
      expect(result.paidAmount).toBe(0);
    });

    it('空项目列表应抛出 BadRequestException', async () => {
      const dto: CreateChargeDto = {
        patientId: 'patient-001',
        items: [],
      };

      await expect(service.createCharge(dto)).rejects.toThrow(BadRequestException);
    });

    it('缺少 items 应抛出 BadRequestException', async () => {
      const dto: any = {
        patientId: 'patient-001',
      };

      await expect(service.createCharge(dto)).rejects.toThrow(BadRequestException);
    });

    it('创建收费单时应同时插入 ChargeItem 记录', async () => {
      const patientId = 'patient-001';
      const dto: CreateChargeDto = {
        patientId,
        items: [
          { name: '拔牙', price: 300, quantity: 1 },
        ],
      };

      const result = await service.createCharge(dto);
      const chargeItems = db.getTableData('ChargeItem');

      expect(chargeItems.length).toBe(1);
      expect(chargeItems[0].chargeId).toBe(result.id);
      expect(chargeItems[0].name).toBe('拔牙');
    });
  });

  // ==================== getCharge ====================

  describe('getCharge', () => {
    it('正常获取收费单详情', async () => {
      // 先创建
      const dto: CreateChargeDto = {
        patientId: 'patient-001',
        items: [{ name: '洗牙', price: 100, quantity: 1 }],
      };
      const created = await service.createCharge(dto);

      // 再获取
      const result = await service.getCharge(created.id);

      expect(result.id).toBe(created.id);
      expect(result.items).toBeDefined();
      expect(result.items.length).toBe(1);
    });

    it('收费单不存在应抛出 NotFoundException', async () => {
      await expect(service.getCharge('non-existent-id')).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== payCharge 验证逻辑 ====================

  describe('payCharge - 验证逻辑', () => {
    it('支付金额为 0 应抛出 BadRequestException', async () => {
      const dto: CreateChargeDto = {
        patientId: 'patient-001',
        items: [{ name: '洗牙', price: 100, quantity: 1 }],
      };
      const charge = await service.createCharge(dto);

      const payDto: PayChargeDto = { amount: 0 };
      await expect(service.payCharge(charge.id, payDto)).rejects.toThrow(BadRequestException);
    });

    it('支付金额为负数应抛出 BadRequestException', async () => {
      const dto: CreateChargeDto = {
        patientId: 'patient-001',
        items: [{ name: '洗牙', price: 100, quantity: 1 }],
      };
      const charge = await service.createCharge(dto);

      const payDto: PayChargeDto = { amount: -50 };
      await expect(service.payCharge(charge.id, payDto)).rejects.toThrow(BadRequestException);
    });

    it('收费单不存在应抛出 NotFoundException', async () => {
      const payDto: PayChargeDto = { amount: 100 };
      await expect(service.payCharge('non-existent-id', payDto)).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== listCharges ====================

  describe('listCharges', () => {
    it('正常获取列表', async () => {
      // 创建几个收费单
      for (let i = 0; i < 3; i++) {
        await service.createCharge({
          patientId: `patient-00${i}`,
          items: [{ name: '洗牙', price: 100, quantity: 1 }],
        });
      }

      const result = await service.listCharges({ page: 1, pageSize: 10 });

      expect(result.items.length).toBe(3);
      expect(result.total).toBe(3);
    });
  });

  // ==================== combos ====================

  describe('charge combos', () => {
    it('正常创建收费组合', async () => {
      const result = await service.createCombo({ name: '洗牙套餐', category: '基础护理' });

      expect(result.id).toBeDefined();
    });

    it('获取组合列表', async () => {
      await service.createCombo({ name: '套餐1' });
      await service.createCombo({ name: '套餐2' });

      const result = await service.listCombos();

      expect(result.items.length).toBeGreaterThanOrEqual(2);
    });
  });

  // ==================== payment methods ====================

  describe('payment methods', () => {
    it('正常创建缴费方式', async () => {
      const result = await service.createPaymentMethod({ name: '微信支付', code: 'WECHAT' });

      expect(result.id).toBeDefined();
    });

    it('获取缴费方式列表', async () => {
      await service.createPaymentMethod({ name: '现金' });
      await service.createPaymentMethod({ name: '微信' });

      const result = await service.listPaymentMethods();

      expect(result.items.length).toBeGreaterThanOrEqual(2);
    });

    it('切换缴费方式启用状态', async () => {
      const created = await service.createPaymentMethod({ name: '支付宝', isEnabled: 1 });

      const result = await service.togglePaymentMethod(created.id);

      expect(result.id).toBe(created.id);
    });
  });
});