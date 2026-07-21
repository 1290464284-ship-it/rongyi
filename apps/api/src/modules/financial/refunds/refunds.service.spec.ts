import { RefundsService } from './refunds.service';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('RefundsService', () => {
  let service: RefundsService;
  let db: MockDbService;
  let idempotency: IdempotencyService;

  beforeEach(() => {
    db = new MockDbService();
    idempotency = new IdempotencyService(db as any);
    service = new RefundsService(db as any, idempotency);
  });

  afterEach(() => {
    db.clear();
  });

  describe('create - 验证逻辑', () => {
    it('退款金额为 0 应抛出 BadRequestException', async () => {
      // Seed a charge
      db.seed('Charge', [{ id: 'charge-001', paidAmount: 100, refundedAmount: 0, status: 'PAID' }]);

      await expect(service.create({ chargeId: 'charge-001', amount: 0 })).rejects.toThrow(BadRequestException);
    });

    it('退款金额为负数应抛出 BadRequestException', async () => {
      db.seed('Charge', [{ id: 'charge-001', paidAmount: 100, refundedAmount: 0, status: 'PAID' }]);

      await expect(service.create({ chargeId: 'charge-001', amount: -10 })).rejects.toThrow(BadRequestException);
    });

    it('收费记录不存在应抛出 NotFoundException', async () => {
      await expect(service.create({ chargeId: 'non-existent', amount: 50 })).rejects.toThrow(NotFoundException);
    });
  });

  describe('findByCharge', () => {
    it('获取收费单的退款列表', async () => {
      db.seed('Refund', [
        { id: 'refund-001', chargeId: 'charge-001', amount: 50 },
        { id: 'refund-002', chargeId: 'charge-001', amount: 30 },
      ]);

      const result = await service.findByCharge('charge-001');

      expect(result.length).toBe(2);
    });
  });

  describe('findMany', () => {
    it('获取退款列表（无过滤）', async () => {
      db.seed('Refund', [
        { id: 'refund-001', chargeId: 'charge-001', patientId: 'patient-001', amount: 50 },
        { id: 'refund-002', chargeId: 'charge-002', patientId: 'patient-002', amount: 30 },
      ]);

      const result = await service.findMany({});

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('按患者过滤', async () => {
      db.seed('Refund', [
        { id: 'refund-001', chargeId: 'charge-001', patientId: 'patient-001', amount: 50 },
      ]);

      const result = await service.findMany({ patientId: 'patient-001' });

      expect(result.items.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('findOne', () => {
    it('获取退款详情', async () => {
      db.seed('Refund', [{ id: 'refund-001', chargeId: 'charge-001', amount: 50 }]);

      const result = await service.findOne('refund-001');

      expect((result as any).id).toBe('refund-001');
      expect((result as any).amount).toBe(50);
    });

    it('退款不存在应抛出 NotFoundException', async () => {
      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });
});