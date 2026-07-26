import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@db/db.service';
import { ClinicContextService } from '@common/services/clinic-context.service';
import { IdempotencyService } from '@common/services/idempotency.service';
import {
  createTestDb,
  cleanupTestDb,
  createTestDbService,
  seedTestData,
  runInClinicContext,
} from '@db/test-helpers';
import {
  TEST_CLINIC_ID,
} from './factories';
import { SuppliersService } from '@modules/inventory/suppliers/suppliers.service';
import { InventoryService } from '@modules/inventory/inventory/inventory.service';

describe('Inventory Integration Tests', () => {
  let suppliersService: SuppliersService;
  let inventoryService: InventoryService;
  let clinicContext: ClinicContextService;
  let db: ReturnType<typeof createTestDb>;
  let module: TestingModule;

  const runAsAdmin = <T>(fn: () => T) =>
    runInClinicContext(
      clinicContext,
      { clinicId: TEST_CLINIC_ID, userId: 'admin-001', role: 'ADMIN' },
      fn,
    );

  beforeEach(async () => {
    db = createTestDb();
    seedTestData(db);

    const testDbService = createTestDbService(db);

    module = await Test.createTestingModule({
      providers: [
        { provide: DbService, useValue: testDbService },
        ClinicContextService,
        IdempotencyService,
        SuppliersService,
        InventoryService,
      ],
    }).compile();

    suppliersService = module.get(SuppliersService);
    inventoryService = module.get(InventoryService);
    clinicContext = module.get(ClinicContextService);
  });

  afterEach(() => {
    cleanupTestDb(db);
  });

  describe('供应商管理', () => {
    it('创建供应商成功', async () => {
      const supplier = await runAsAdmin(() =>
        suppliersService.create({
          name: '牙科材料供应商A',
          contactPerson: '张三',
          phone: '13800000001',
          address: '北京市朝阳区xxx路xxx号',
          remark: '主要供应种植体',
        } as any),
      );

      expect(supplier.id).toBeDefined();
      expect((supplier as any).name).toBe('牙科材料供应商A');
    });

    it('供应商列表分页查询', async () => {
      for (let i = 0; i < 5; i++) {
        await runAsAdmin(() =>
          suppliersService.create({
            name: `供应商${i}`,
            phone: `138000000${i.toString().padStart(2, '0')}`,
          } as any),
        );
      }

      const result = await runAsAdmin(() =>
        suppliersService.findMany({ page: 1, pageSize: 3 }),
      );

      expect((result as any).items.length).toBe(3);
      expect((result as any).total).toBe(5);
    });

    it('按名称搜索供应商', async () => {
      await runAsAdmin(() =>
        suppliersService.create({ name: '北京材料公司', phone: '111' } as any),
      );
      await runAsAdmin(() =>
        suppliersService.create({ name: '上海设备公司', phone: '222' } as any),
      );

      const result = await runAsAdmin(() =>
        suppliersService.findMany({ page: 1, pageSize: 10, keyword: '北京' }),
      );

      expect((result as any).items.length).toBeGreaterThanOrEqual(1);
      expect((result as any).items[0].name).toContain('北京');
    });

    it('更新供应商信息', async () => {
      const supplier = await runAsAdmin(() =>
        suppliersService.create({ name: '原名称', phone: '111' } as any),
      );

      const updated = await runAsAdmin(() =>
        suppliersService.update(supplier.id, { name: '新名称', contactPerson: '李经理' } as any),
      );

      expect((updated as any).name).toBe('新名称');
      expect((updated as any).contactPerson).toBe('李经理');
    });

    it('软删除供应商', async () => {
      const supplier = await runAsAdmin(() =>
        suppliersService.create({ name: '待删除供应商', phone: '333' } as any),
      );

      await runAsAdmin(() => suppliersService.softDelete(supplier.id));

      const row = db.prepare('SELECT deletedAt FROM Supplier WHERE id = ?').get(supplier.id) as any;
      expect(row.deletedAt).not.toBeNull();
    });
  });

  describe('库存管理', () => {
    it('创建库存物品成功', async () => {
      const item = await runAsAdmin(() =>
        inventoryService.create({
          code: 'ITEM-TEST-001',
          name: '一次性手套',
          category: '耗材',
          unit: '盒',
          price: 2550,
          stock: 100,
          minStock: 20,
          spec: 'M号/100只',
        } as any),
      );

      expect(item.id).toBeDefined();
      expect((item as any).name).toBe('一次性手套');
    });

    it('库存列表分页查询', async () => {
      for (let i = 0; i < 6; i++) {
        await runAsAdmin(() =>
          inventoryService.create({
            code: `ITEM-${i}`,
            name: `材料${i}`,
            category: '耗材',
            unit: '个',
            stock: 50,
            price: 1000,
          } as any),
        );
      }

      const result = await runAsAdmin(() =>
        inventoryService.findMany({ page: 2, pageSize: 2 } as any),
      );

      expect((result as any).items.length).toBe(2);
      expect((result as any).total).toBe(6);
    });

    it('库存列表按名称搜索', async () => {
      await runAsAdmin(() =>
        inventoryService.create({ code: 'S-GLOVE', name: '医用手套', category: '耗材', unit: '盒', stock: 50, price: 2000 } as any),
      );
      await runAsAdmin(() =>
        inventoryService.create({ code: 'S-MASK', name: '医用口罩', category: '耗材', unit: '盒', stock: 100, price: 3000 } as any),
      );

      const result = await runAsAdmin(() =>
        inventoryService.findMany({ page: 1, pageSize: 10, keyword: '手套' } as any),
      );

      expect((result as any).items.length).toBeGreaterThanOrEqual(1);
      expect((result as any).items[0].name).toContain('手套');
    });

    it('查询单个库存物品详情', async () => {
      const created = await runAsAdmin(() =>
        inventoryService.create({
          code: 'ITEM-DETAIL',
          name: '详情测试物品',
          category: '耗材',
          unit: '个',
          stock: 30,
          price: 1500,
          spec: '规格X',
        } as any),
      );

      const found = await runAsAdmin(() => inventoryService.findOne(created.id));
      expect(found.id).toBe(created.id);
      expect((found as any).name).toBe('详情测试物品');
    });

    it('库存入库操作', async () => {
      const item = await runAsAdmin(() =>
        inventoryService.create({
          code: 'ITEM-STOCK-IN',
          name: '入库测试材料',
          category: '耗材',
          unit: '盒',
          stock: 10,
          price: 1000,
        } as any),
      );

      const result = await runAsAdmin(() =>
        inventoryService.stockAction({
          itemId: item.id,
          type: 'IN',
          quantity: 20,
          unitPrice: 1000,
          remark: '采购入库',
        } as any),
      );

      expect((result as any).stock).toBe(30);

      const transactions = await runAsAdmin(() => inventoryService.findTransactions(item.id));
      expect((transactions as any[]).length).toBe(1);
      expect((transactions as any[])[0].type).toBe('IN');
      expect((transactions as any[])[0].quantity).toBe(20);
    });

    it('库存出库操作', async () => {
      const item = await runAsAdmin(() =>
        inventoryService.create({
          code: 'ITEM-STOCK-OUT',
          name: '出库测试材料',
          category: '耗材',
          unit: '盒',
          stock: 50,
          price: 1000,
        } as any),
      );

      const result = await runAsAdmin(() =>
        inventoryService.stockAction({
          itemId: item.id,
          type: 'OUT',
          quantity: 15,
          remark: '诊所领用',
        } as any),
      );

      expect((result as any).stock).toBe(35);
    });

    it('库存出库超过库存时报错', async () => {
      const item = await runAsAdmin(() =>
        inventoryService.create({
          code: 'ITEM-OVER-OUT',
          name: '超量出库测试',
          category: '耗材',
          unit: '个',
          stock: 10,
          price: 500,
        } as any),
      );

      await expect(
        runAsAdmin(() =>
          inventoryService.stockAction({
            itemId: item.id,
            type: 'OUT',
            quantity: 20,
          } as any),
        ),
      ).rejects.toThrow('库存不足');
    });

    it('库存调整操作', async () => {
      const item = await runAsAdmin(() =>
        inventoryService.create({
          code: 'ITEM-ADJUST',
          name: '调整测试材料',
          category: '耗材',
          unit: '个',
          stock: 100,
          price: 500,
        } as any),
      );

      const result = await runAsAdmin(() =>
        inventoryService.stockAction({
          itemId: item.id,
          type: 'ADJUST',
          quantity: 75,
          remark: '盘点调整',
        } as any),
      );

      expect((result as any).stock).toBe(75);
    });

    it('库存操作幂等性：相同 requestId 只执行一次', async () => {
      const item = await runAsAdmin(() =>
        inventoryService.create({
          code: 'ITEM-IDEMPOTENT',
          name: '幂等测试材料',
          category: '耗材',
          unit: '个',
          stock: 10,
          price: 500,
        } as any),
      );

      const requestId = 'test-req-001';
      const actionDto = {
        itemId: item.id,
        type: 'IN',
        quantity: 5,
        unitPrice: 500,
        requestId,
      } as any;

      const result1 = await runAsAdmin(() => inventoryService.stockAction(actionDto));
      const result2 = await runAsAdmin(() => inventoryService.stockAction(actionDto));

      expect((result1 as any).stock).toBe(15);
      expect((result2 as any).stock).toBe(15);

      const transactions = await runAsAdmin(() => inventoryService.findTransactions(item.id));
      expect((transactions as any[]).length).toBe(1);
    });

    it('低库存预警查询', async () => {
      await runAsAdmin(() =>
        inventoryService.create({
          code: 'LOW-STOCK-1',
          name: '低库存物品1',
          category: '耗材',
          unit: '个',
          stock: 5,
          minStock: 10,
          price: 100,
        } as any),
      );
      await runAsAdmin(() =>
        inventoryService.create({
          code: 'LOW-STOCK-2',
          name: '低库存物品2',
          category: '耗材',
          unit: '个',
          stock: 8,
          minStock: 20,
          price: 200,
        } as any),
      );
      await runAsAdmin(() =>
        inventoryService.create({
          code: 'HIGH-STOCK',
          name: '充足库存物品',
          category: '耗材',
          unit: '个',
          stock: 100,
          minStock: 10,
          price: 300,
        } as any),
      );

      const lowStockItems = await runAsAdmin(() => inventoryService.findLowStockItems());
      expect((lowStockItems as any[]).length).toBeGreaterThanOrEqual(2);
      expect((lowStockItems as any[]).every((i: any) => i.stock <= i.minStock)).toBe(true);
    });
  });
});
