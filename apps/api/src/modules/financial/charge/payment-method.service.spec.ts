import { PaymentMethodService } from './payment-method.service';
import { MockDbService, MockDbRow } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { NotFoundException } from '@nestjs/common';

function createMockClinicContext(): ClinicContextService {
  return {
    getClinicId: () => 'test-clinic-001',
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('PaymentMethodService', () => {
  let service: PaymentMethodService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new PaymentMethodService(db as any, createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  function seedPaymentMethod(overrides: Record<string, unknown> = {}): MockDbRow {
    const id = overrides.id || 'pm-001';
    const method: MockDbRow = {
      id,
      name: '现金',
      code: 'CASH',
      parentId: null,
      sortOrder: 1,
      isEnabled: 1,
      clinicId: 'test-clinic-001',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      ...overrides,
    };
    db.seed('PaymentMethod', [method]);
    return method;
  }

  // ==================== listPaymentMethods ====================

  describe('listPaymentMethods - 支付方式列表', () => {
    beforeEach(() => {
      const methods = [
        { id: 'pm-001', name: '现金', code: 'CASH', sortOrder: 1 },
        { id: 'pm-002', name: '微信支付', code: 'WECHAT', sortOrder: 2 },
        { id: 'pm-003', name: '支付宝', code: 'ALIPAY', sortOrder: 3 },
      ];
      methods.forEach(m => seedPaymentMethod(m));
    });

    it('应返回所有支付方式', async () => {
      const result = await service.listPaymentMethods();
      expect(result.total).toBe(3);
      expect(result.items.length).toBe(3);
    });

    it('应按 sortOrder 升序排列', async () => {
      const result = await service.listPaymentMethods();
      const codes = result.items.map((item: any) => item.code);
      expect(codes).toEqual(['CASH', 'WECHAT', 'ALIPAY']);
    });

    it('不应返回已删除的支付方式', async () => {
      seedPaymentMethod({ id: 'pm-deleted', name: '已删除', code: 'DELETED', deletedAt: new Date().toISOString() });
      const result = await service.listPaymentMethods();
      expect(result.total).toBe(3);
    });

    it('只返回当前诊所的支付方式', async () => {
      seedPaymentMethod({ id: 'pm-other', name: '其他诊所', code: 'OTHER', clinicId: 'other-clinic' });
      const result = await service.listPaymentMethods();
      expect(result.total).toBe(3);
    });
  });

  // ==================== createPaymentMethod ====================

  describe('createPaymentMethod - 创建支付方式', () => {
    it('应成功创建支付方式', async () => {
      const result = await service.createPaymentMethod({
        name: '银行卡',
        code: 'BANK_CARD',
        sortOrder: 4,
      });

      expect(result).toBeDefined();
      expect(result.name).toBe('银行卡');
      expect(result.code).toBe('BANK_CARD');
      expect(result.sortOrder).toBe(4);
      expect(result.clinicId).toBe('test-clinic-001');
    });

    it('创建时可以指定 isEnabled 为启用状态', async () => {
      const result = await service.createPaymentMethod({
        name: '新支付方式',
        code: 'NEW_METHOD',
      });
      expect(result).toBeDefined();
      expect(result.name).toBe('新支付方式');
    });

    it('支持设置 parentId', async () => {
      seedPaymentMethod({ id: 'parent-001', name: '父级', code: 'PARENT' });
      const result = await service.createPaymentMethod({
        name: '子支付方式',
        code: 'CHILD',
        parentId: 'parent-001',
      });
      expect(result.parentId).toBe('parent-001');
    });

    it('sortOrder 可选，不设置时使用默认值', async () => {
      const result = await service.createPaymentMethod({
        name: '无排序',
        code: 'NO_ORDER',
      });
      expect(result).toBeDefined();
    });
  });

  // ==================== updatePaymentMethod ====================

  describe('updatePaymentMethod - 更新支付方式', () => {
    beforeEach(() => {
      seedPaymentMethod({ id: 'pm-001', name: '现金', code: 'CASH', sortOrder: 1 });
    });

    it('应更新支付方式名称', async () => {
      const result = await service.updatePaymentMethod('pm-001', { name: '现金支付' });
      expect(result.name).toBe('现金支付');
    });

    it('应更新支付方式编码', async () => {
      const result = await service.updatePaymentMethod('pm-001', { code: 'CASH_PAY' });
      expect(result.code).toBe('CASH_PAY');
    });

    it('应更新排序', async () => {
      const result = await service.updatePaymentMethod('pm-001', { sortOrder: 10 });
      expect(result.sortOrder).toBe(10);
    });

    it('应更新父级', async () => {
      seedPaymentMethod({ id: 'parent-new', name: '新父级', code: 'NEW_PARENT' });
      const result = await service.updatePaymentMethod('pm-001', { parentId: 'parent-new' });
      expect(result.parentId).toBe('parent-new');
    });

    it('可以清空 parentId（设为 null）', async () => {
      seedPaymentMethod({ id: 'pm-child', name: '子级', code: 'CHILD', parentId: 'pm-001' });
      const result = await service.updatePaymentMethod('pm-child', { parentId: null });
      expect(result.parentId).toBeNull();
    });

    it('不存在的支付方式应抛出 NotFoundException', async () => {
      await expect(
        service.updatePaymentMethod('non-existent', { name: 'test' }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== deletePaymentMethod ====================

  describe('deletePaymentMethod - 删除支付方式', () => {
    beforeEach(() => {
      seedPaymentMethod({ id: 'pm-001', name: '现金', code: 'CASH' });
    });

    it('应软删除支付方式', async () => {
      await service.deletePaymentMethod('pm-001');
      const methods = db.getTableData('PaymentMethod');
      const deleted = methods.find(m => m.id === 'pm-001');
      expect(deleted).toBeDefined();
      expect(deleted.deletedAt).not.toBeNull();
    });

    it('删除后列表中不应包含该支付方式', async () => {
      await service.deletePaymentMethod('pm-001');
      const result = await service.listPaymentMethods();
      expect(result.total).toBe(0);
    });

    it('应写入 SOFT_DELETE 审计日志', async () => {
      await service.deletePaymentMethod('pm-001');
      const auditLogs = db.getTableData('AuditLog');
      const deleteLogs = auditLogs.filter(l => l.type === 'SOFT_DELETE');
      expect(deleteLogs.length).toBe(1);
      expect(deleteLogs[0].targetId).toBe('pm-001');
      expect(deleteLogs[0].targetType).toBe('PaymentMethod');
    });

    it('不存在的支付方式应抛出 NotFoundException', async () => {
      await expect(
        service.deletePaymentMethod('non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== togglePaymentMethod ====================

  describe('togglePaymentMethod - 切换启用状态', () => {
    it('启用状态切换为禁用', async () => {
      seedPaymentMethod({ id: 'pm-001', name: '现金', code: 'CASH', isEnabled: 1 });
      const result = await service.togglePaymentMethod('pm-001');
      expect(result.isEnabled).toBe(0);
    });

    it('禁用状态切换为启用', async () => {
      seedPaymentMethod({ id: 'pm-001', name: '现金', code: 'CASH', isEnabled: 0 });
      const result = await service.togglePaymentMethod('pm-001');
      expect(result.isEnabled).toBe(1);
    });

    it('多次切换应正确翻转状态', async () => {
      seedPaymentMethod({ id: 'pm-001', name: '现金', code: 'CASH', isEnabled: 1 });
      
      let result = await service.togglePaymentMethod('pm-001');
      expect(result.isEnabled).toBe(0);
      
      result = await service.togglePaymentMethod('pm-001');
      expect(result.isEnabled).toBe(1);
      
      result = await service.togglePaymentMethod('pm-001');
      expect(result.isEnabled).toBe(0);
    });

    it('不存在的支付方式应抛出 NotFoundException', async () => {
      await expect(
        service.togglePaymentMethod('non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== findOne ====================

  describe('findOne - 查询单个支付方式（继承自 BaseService）', () => {
    it('应返回指定 id 的支付方式', async () => {
      seedPaymentMethod({ id: 'pm-001', name: '现金', code: 'CASH' });
      const result = await service.findOne('pm-001');
      expect(result).toBeDefined();
      expect(result.id).toBe('pm-001');
      expect(result.name).toBe('现金');
    });

    it('不存在的 id 应抛出 NotFoundException', async () => {
      await expect(
        service.findOne('non-existent'),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
