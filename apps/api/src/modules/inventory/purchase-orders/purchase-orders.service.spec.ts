import { PurchaseOrdersService } from './purchase-orders.service';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { BadRequestException } from '@nestjs/common';

// 构造 ClinicContextService 的 mock，模拟诊所上下文
function createMockClinicContext(): ClinicContextService {
  return {
    getClinicId: () => 'test-clinic-001',
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    getUserAgent: () => 'jest-test-agent',
    getSource: () => 'test',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('PurchaseOrdersService', () => {
  let service: PurchaseOrdersService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new PurchaseOrdersService(db as any, createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  // ==================== createOrder ====================

  describe('createOrder - 创建采购订单', () => {
    it('正常创建采购订单应生成 PENDING 状态及采购单号', async () => {
      const dto = {
        supplierId: 'supplier-001',
        items: [
          { itemId: 'inv-001', name: '一次性手套', spec: '100只装', quantity: 5, unitPrice: 10 },
        ],
      };

      const result = await service.createOrder(dto, { id: 'user-001', name: '张三' });

      expect(result).toBeDefined();
      expect((result as any).id).toBeDefined();
      expect((result as any).number).toMatch(/^PO[0-9a-f]+$/);
      expect((result as any).supplierId).toBe('supplier-001');
      expect((result as any).status).toBe('PENDING');
      expect((result as any).operatorId).toBe('user-001');
      // 单项金额：10 元 × 5 = 50 元
      expect((result as any).totalAmount).toBe(50);

      // 验证采购单明细已写入
      const items = db.getTableData('PurchaseOrderItem');
      expect(items.length).toBe(1);
      expect(items[0].name).toBe('一次性手套');
      expect(items[0].quantity).toBe(5);
      expect(items[0].unitPrice).toBe(10);
    });

    it('多个商品的金额计算应正确（分转元链路）', async () => {
      // 2 件商品：10 元 × 3 + 5.5 元 × 4 = 30 + 22 = 52 元
      const dto = {
        supplierId: 'supplier-002',
        items: [
          { name: '牙科注射器', quantity: 3, unitPrice: 10 },
          { name: '棉卷', quantity: 4, unitPrice: 5.5 },
        ],
      };

      const result = await service.createOrder(dto);

      expect(result).toBeDefined();
      // 金额计算：yuanToCents(10)=1000, ×3=3000; yuanToCents(5.5)=550, ×4=2200; sumCents=5200; centsToYuan=52
      expect((result as any).totalAmount).toBe(52);

      const items = db.getTableData('PurchaseOrderItem');
      expect(items.length).toBe(2);
      // 验证每项小计：subtotal = centsToYuan(multiplyCents(yuanToCents(unitPrice), quantity))
      const syringe = items.find((i: any) => i.name === '牙科注射器');
      expect(syringe.subtotal).toBe(30);
      const cotton = items.find((i: any) => i.name === '棉卷');
      expect(cotton.subtotal).toBe(22);
    });
  });

  // ==================== receive ====================

  describe('receive - 入库收货', () => {
    it('正常入库应更新库存、生成库存流水并将采购单状态置为 RECEIVED', async () => {
      // 预置库存商品，初始库存 100
      db.seed('InventoryItem', [
        {
          id: 'inv-001',
          name: '一次性手套',
          spec: '100只装',
          unit: '盒',
          stock: 100,
          clinicId: 'test-clinic-001',
          deletedAt: null,
        },
      ]);

      // 创建采购单：采购 5 盒手套，单价 10 元
      const po = await service.createOrder(
        {
          supplierId: 'supplier-001',
          items: [{ itemId: 'inv-001', name: '一次性手套', quantity: 5, unitPrice: 10 }],
        },
        { id: 'user-001', name: '张三' },
      );

      const result = await service.receive((po as any).id, { id: 'user-001', name: '张三' });

      // 验证采购单状态变为 RECEIVED
      expect(result).toBeDefined();
      expect((result as any).status).toBe('RECEIVED');

      // 验证库存累加：100 + 5 = 105
      const invItems = db.getTableData('InventoryItem');
      const updatedInv = invItems.find((i: any) => i.id === 'inv-001');
      expect(updatedInv.stock).toBe(105);

      // 验证库存流水记录已生成
      const txns = db.getTableData('InventoryTransaction');
      expect(txns.length).toBe(1);
      expect(txns[0].type).toBe('IN');
      expect(txns[0].quantity).toBe(5);
      expect(txns[0].itemId).toBe('inv-001');
      expect(txns[0].remark).toBe('采购入库');
    });

    it('已收货的采购单重复收货应抛出 BadRequestException', async () => {
      db.seed('PurchaseOrder', [
        {
          id: 'po-received',
          number: 'PO0001',
          supplierId: 'supplier-001',
          totalAmount: 50,
          status: 'RECEIVED',
          operatorId: null,
          clinicId: 'test-clinic-001',
          deletedAt: null,
        },
      ]);

      await expect(service.receive('po-received')).rejects.toThrow(BadRequestException);
    });

    it('非 PENDING/PARTIAL 状态的采购单收货应抛出 BadRequestException', async () => {
      db.seed('PurchaseOrder', [
        {
          id: 'po-cancelled',
          number: 'PO0002',
          supplierId: 'supplier-001',
          totalAmount: 50,
          status: 'CANCELLED',
          operatorId: null,
          clinicId: 'test-clinic-001',
          deletedAt: null,
        },
      ]);

      await expect(service.receive('po-cancelled')).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== cancel ====================

  describe('cancel - 取消采购单', () => {
    it('PENDING 状态的采购单应成功取消', async () => {
      db.seed('PurchaseOrder', [
        {
          id: 'po-pending',
          number: 'PO0003',
          supplierId: 'supplier-001',
          totalAmount: 100,
          status: 'PENDING',
          operatorId: null,
          clinicId: 'test-clinic-001',
          deletedAt: null,
        },
      ]);

      const result = await service.cancel('po-pending');

      expect(result).toBeDefined();
      expect((result as any).status).toBe('CANCELLED');
    });

    it('已收货的采购单取消应抛出 BadRequestException', async () => {
      db.seed('PurchaseOrder', [
        {
          id: 'po-received-2',
          number: 'PO0004',
          supplierId: 'supplier-001',
          totalAmount: 100,
          status: 'RECEIVED',
          operatorId: null,
          clinicId: 'test-clinic-001',
          deletedAt: null,
        },
      ]);

      await expect(service.cancel('po-received-2')).rejects.toThrow(BadRequestException);
    });

    it('已取消的采购单再次取消应抛出 BadRequestException', async () => {
      db.seed('PurchaseOrder', [
        {
          id: 'po-cancelled-2',
          number: 'PO0005',
          supplierId: 'supplier-001',
          totalAmount: 100,
          status: 'CANCELLED',
          operatorId: null,
          clinicId: 'test-clinic-001',
          deletedAt: null,
        },
      ]);

      await expect(service.cancel('po-cancelled-2')).rejects.toThrow(BadRequestException);
    });
  });

  // ==================== findMany ====================

  describe('findMany - 查询采购单', () => {
    beforeEach(() => {
      db.seed('PurchaseOrder', [
        {
          id: 'po-001',
          number: 'PO1001',
          supplierId: 'supplier-A',
          totalAmount: 100,
          status: 'PENDING',
          operatorId: null,
          clinicId: 'test-clinic-001',
          deletedAt: null,
        },
        {
          id: 'po-002',
          number: 'PO1002',
          supplierId: 'supplier-B',
          totalAmount: 200,
          status: 'RECEIVED',
          operatorId: null,
          clinicId: 'test-clinic-001',
          deletedAt: null,
        },
        {
          id: 'po-003',
          number: 'PO1003',
          supplierId: 'supplier-A',
          totalAmount: 300,
          status: 'RECEIVED',
          operatorId: null,
          clinicId: 'test-clinic-001',
          deletedAt: null,
        },
      ]);
    });

    it('按供应商过滤应只返回该供应商的采购单', async () => {
      const result = await service.findMany({ supplierId: 'supplier-A' });

      expect(result.items.length).toBe(2);
      expect(result.items.every((i: any) => i.supplierId === 'supplier-A')).toBe(true);
    });

    it('按状态过滤应只返回匹配状态的采购单', async () => {
      const result = await service.findMany({ status: 'RECEIVED' });

      expect(result.items.length).toBe(2);
      expect(result.items.every((i: any) => i.status === 'RECEIVED')).toBe(true);
    });

    it('分页查询应返回正确的分页信息', async () => {
      const result = await service.findMany({ page: 1, pageSize: 2 });

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });
  });

  // ==================== updateStatus ====================

  describe('updateStatus - 状态转换', () => {
    it('PENDING → RECEIVED 应成功', async () => {
      db.seed('PurchaseOrder', [{
        id: 'po-001', number: 'PO2001', supplierId: 'supplier-001',
        totalAmount: 100, status: 'PENDING', operatorId: null,
        clinicId: 'test-clinic-001', deletedAt: null,
      }]);

      const result = await service.updateStatus('po-001', 'RECEIVED');
      expect((result as any).status).toBe('RECEIVED');
    });

    it('PENDING → CANCELLED 应成功', async () => {
      db.seed('PurchaseOrder', [{
        id: 'po-001', number: 'PO2002', supplierId: 'supplier-001',
        totalAmount: 100, status: 'PENDING', operatorId: null,
        clinicId: 'test-clinic-001', deletedAt: null,
      }]);

      const result = await service.updateStatus('po-001', 'CANCELLED');
      expect((result as any).status).toBe('CANCELLED');
    });

    it('PENDING → PARTIAL 应成功', async () => {
      db.seed('PurchaseOrder', [{
        id: 'po-001', number: 'PO2003', supplierId: 'supplier-001',
        totalAmount: 100, status: 'PENDING', operatorId: null,
        clinicId: 'test-clinic-001', deletedAt: null,
      }]);

      const result = await service.updateStatus('po-001', 'PARTIAL');
      expect((result as any).status).toBe('PARTIAL');
    });

    it('RECEIVED → PENDING 应抛出 BadRequestException（非法转换）', async () => {
      db.seed('PurchaseOrder', [{
        id: 'po-001', number: 'PO2004', supplierId: 'supplier-001',
        totalAmount: 100, status: 'RECEIVED', operatorId: null,
        clinicId: 'test-clinic-001', deletedAt: null,
      }]);

      await expect(service.updateStatus('po-001', 'PENDING')).rejects.toThrow(BadRequestException);
    });

    it('CANCELLED → RECEIVED 应抛出 BadRequestException（非法转换）', async () => {
      db.seed('PurchaseOrder', [{
        id: 'po-001', number: 'PO2005', supplierId: 'supplier-001',
        totalAmount: 100, status: 'CANCELLED', operatorId: null,
        clinicId: 'test-clinic-001', deletedAt: null,
      }]);

      await expect(service.updateStatus('po-001', 'RECEIVED')).rejects.toThrow(BadRequestException);
    });

    it('PARTIAL → RECEIVED 应成功', async () => {
      db.seed('PurchaseOrder', [{
        id: 'po-001', number: 'PO2006', supplierId: 'supplier-001',
        totalAmount: 100, status: 'PARTIAL', operatorId: null,
        clinicId: 'test-clinic-001', deletedAt: null,
      }]);

      const result = await service.updateStatus('po-001', 'RECEIVED');
      expect((result as any).status).toBe('RECEIVED');
    });

    it('PARTIAL → CANCELLED 应成功', async () => {
      db.seed('PurchaseOrder', [{
        id: 'po-001', number: 'PO2007', supplierId: 'supplier-001',
        totalAmount: 100, status: 'PARTIAL', operatorId: null,
        clinicId: 'test-clinic-001', deletedAt: null,
      }]);

      const result = await service.updateStatus('po-001', 'CANCELLED');
      expect((result as any).status).toBe('CANCELLED');
    });
  });

  // ==================== receive - 更多场景 ====================

  describe('receive - 更多场景', () => {
    it('收货应更新对应库存项的数量', async () => {
      db.seed('InventoryItem', [
        { id: 'inv-001', name: '棉卷', unit: '包', stock: 50, clinicId: 'test-clinic-001', deletedAt: null },
      ]);

      const po = await service.createOrder({
        supplierId: 'supplier-001',
        items: [{ itemId: 'inv-001', name: '棉卷', quantity: 10, unitPrice: 3 }],
      }, { id: 'user-001', name: '张三' });

      await service.receive((po as any).id, { id: 'user-001', name: '张三' });

      const invItems = db.getTableData('InventoryItem');
      const updated = invItems.find((i: any) => i.id === 'inv-001');
      expect(updated.stock).toBe(60);
    });

    it('不存在的采购单收货应抛出 NotFoundException', async () => {
      await expect(service.receive('non-existent')).rejects.toThrow();
    });
  });

  // ==================== findOne ====================

  describe('findOne - 查询单个采购单', () => {
    it('查询存在的采购单应返回完整信息', async () => {
      db.seed('PurchaseOrder', [{
        id: 'po-001', number: 'PO3001', supplierId: 'supplier-001',
        totalAmount: 250, status: 'PENDING', operatorId: 'user-001',
        clinicId: 'test-clinic-001', deletedAt: null,
      }]);

      const result = await service.findOne('po-001');
      expect((result as any).id).toBe('po-001');
      expect((result as any).number).toBe('PO3001');
      expect((result as any).status).toBe('PENDING');
      expect((result as any).totalAmount).toBe(250);
    });

    it('查询不存在的采购单应抛出 NotFoundException', async () => {
      await expect(service.findOne('non-existent')).rejects.toThrow();
    });
  });
});
