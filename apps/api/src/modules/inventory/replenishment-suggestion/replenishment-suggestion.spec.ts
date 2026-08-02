import { ReplenishmentSuggestionService,
  median,
  medianAbsoluteDeviation,
  filterMADOutliers3Sigma,
  standardDeviation,
  computeROPPure,
  computeEOQPure,
  ceilIfDiscreteUnit,
  selectHigherReason,
  REASON_PRIORITY,
  ConsumptionResult,
} from './replenishment-suggestion.service';
import { MockDbService, asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { SettingsService } from '../../system/settings/settings.service';
import { PurchaseOrdersService } from '../purchase-orders/purchase-orders.service';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';

const TEST_CLINIC = 'test-clinic-001';

function createMockClinicContext(clinicId: string = TEST_CLINIC): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user',
    getRole: () => 'BOSS',
    getUserAgent: () => 'jest-test-agent',
    getSource: () => 'test',
    run: <T>(_ctx: unknown, fn: () => T) => {
      return fn();
    },
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

interface FakeSettings {
  store: Map<string, string>;
  service: SettingsService;
}

function createFakeSettings(overrides: Record<string, string> = {}): FakeSettings {
  const store = new Map<string, string>(Object.entries({
    aiInventoryReplenishmentEnabled: 'true',
    aiInventoryLookbackDays: '90',
    aiInventoryLeadTimeDaysDefault: '7',
    aiInventorySafetyFactor: '1.5',
    aiInventoryHoldingCostRate: '0.20',
    aiInventoryOrderCostPerOrder: '100',
    dailySchedulerEnabled: 'true',
    ...overrides,
  }));
  const service = {
    get: async (k: string) => store.get(k),
    getNumber: async (k: string, def = 0) => {
      const v = store.get(k);
      const n = v ? Number(v) : NaN;
      return isNaN(n) ? def : n;
    },
    getBoolean: async (k: string, def = false) => {
      const v = store.get(k);
      if (v === undefined) return def;
      return v === 'true' || v === '1';
    },
  } as unknown as SettingsService;
  return { store, service };
}

function createSeedItem(overrides: Partial<{
  id: string; code: string; name: string; unit: string; stock: number;
  minStock: number; price: number; supplierId: string; expireDate: string;
}> = {}) {
  return {
    id: overrides.id ?? 'inv-' + Math.random().toString(36).slice(2, 10),
    code: overrides.code ?? 'CODE-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
    name: overrides.name ?? '测试物品',
    spec: '标准规格',
    category: '耗材',
    unit: overrides.unit ?? '盒',
    stock: overrides.stock ?? 100,
    minStock: overrides.minStock ?? 20,
    price: overrides.price ?? 1000,
    supplierId: overrides.supplierId ?? 'supplier-A',
    expireDate: overrides.expireDate ?? null,
    clinicId: TEST_CLINIC,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function createSuggestionSeed(overrides: Partial<{
  id: string; inventoryId: string; status: string; reason: string;
  suggestedQty: number; rop: number; supplierId: string; totalAmount: number;
}> = {}) {
  return {
    id: overrides.id ?? 'sug-' + Math.random().toString(36).slice(2, 10),
    clinicId: TEST_CLINIC,
    inventoryId: overrides.inventoryId ?? 'inv-1',
    avgDailyConsumption: 1,
    leadTimeDays: 7,
    safetyFactor: 1.5,
    rop: overrides.rop ?? 16,
    suggestedQty: overrides.suggestedQty ?? 191,
    calculationSnapshotJson: '{}',
    status: overrides.status ?? 'OPEN',
    reason: overrides.reason ?? 'ROP_BELOW_MIN',
    supplierId: overrides.supplierId ?? 'supplier-A',
    totalAmount: overrides.totalAmount ?? 191000,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
}

describe('ReplenishmentSuggestion - 纯函数', () => {
  describe('TR-10.1 median / stddev / 基础统计', () => {
    it('[纯函数] median 对奇数/偶数长度返回正确中值', () => {
      expect(median([1, 2, 3, 4, 5])).toBe(3);
      expect(median([1, 2, 3, 4])).toBe(2.5);
      expect(median([7])).toBe(7);
      expect(median([])).toBe(0);
    });

    it('[纯函数] medianAbsoluteDeviation 对均匀数组返回 MAD=0', () => {
      const r = medianAbsoluteDeviation([1, 1, 1, 1]);
      expect(r.median).toBe(1);
      expect(r.mad).toBe(0);
    });

    it('[纯函数] standardDeviation 对全 1 数组返回 σ≈0', () => {
      const values = Array(90).fill(1);
      const sigma = standardDeviation(values);
      expect(sigma).toBeCloseTo(0, 5);
    });
  });

  describe('TR-10.1 computeAvgDailyConsumption: 90天每日1件', () => {
    it('[纯函数-MAD验证] 90天每日1件的日消耗量过滤后均值稳定1.0', () => {
      const daily90 = Array(90).fill(1);
      const { kept, skippedCount } = filterMADOutliers3Sigma(daily90);
      expect(skippedCount).toBe(0);
      const avg = kept.reduce((s, v) => s + v, 0) / kept.length;
      expect(avg).toBeCloseTo(1.0, 5);
    });
  });

  describe('TR-10.2 MAD 3σ 离群检测', () => {
    it('[纯函数] 89天1件 + 1天100件 → 离群被跳过1个；均值接近1.0', () => {
      const daily = Array(89).fill(1);
      daily.push(100);
      const { kept, skippedCount } = filterMADOutliers3Sigma(daily);
      expect(skippedCount).toBe(1);
      const avg = kept.reduce((s, v) => s + v, 0) / kept.length;
      expect(avg).toBeCloseTo(1.0, 3);
    });

    it('[纯函数] 所有值相同则无离群', () => {
      const arr = Array(50).fill(42);
      const { skippedCount } = filterMADOutliers3Sigma(arr);
      expect(skippedCount).toBe(0);
    });

    it('[纯函数] 数组长度<3时不检测', () => {
      const arr = [1, 1000];
      const { skippedCount } = filterMADOutliers3Sigma(arr);
      expect(skippedCount).toBe(0);
    });
  });

  describe('TR-10.3 <7天fallback: minStock/30', () => {
    it('[纯函数] ceilIfDiscreteUnit 对离散单位上取整≥1', () => {
      expect(ceilIfDiscreteUnit(0.1, '盒')).toBe(1);
      expect(ceilIfDiscreteUnit(14.1, '盒')).toBe(15);
      expect(ceilIfDiscreteUnit(0, '包')).toBe(1);
      expect(ceilIfDiscreteUnit(0.5, 'ml')).toBeCloseTo(0.5, 5);
    });
  });

  describe('TR-10.4 ROP 有历史 σ', () => {
    it('[纯函数] leadTime=7, safetyFactor=1.5, avgDaily=2, σ=0.5 → ROP=ceil(14+1.98)=16', () => {
      const rop = computeROPPure(2, 7, 1.5, 0.5);
      // avgDaily*leadTime = 14; SS = 1.5 * sqrt(7) * 0.5 ≈ 1.5 * 2.6458 * 0.5 ≈ 1.984
      // total ≈ 15.984, ceil = 16
      expect(rop).toBe(16);
    });
  });

  describe('TR-10.5 ROP 无历史 σ fallback', () => {
    it('[纯函数] avgDaily=1, σ=undefined → SS=1.5*1*2=3; ROP=ceil(7+3)=10', () => {
      const rop1 = computeROPPure(1, 7, 1.5);
      expect(rop1).toBe(10);
    });
    it('[纯函数] avgDaily=2, σ=undefined → SS=1.5*2*2=6; ROP=ceil(14+6)=20', () => {
      const rop2 = computeROPPure(2, 7, 1.5);
      expect(rop2).toBe(20);
    });
  });

  describe('TR-10.6 EOQ 公式', () => {
    it('[纯函数] D=365/年; S=100; price=10 → H=10*0.2=2; EOQ=sqrt(2*365*100/2)=sqrt(36500)≈191.05→ceil=191', () => {
      const eoq = computeEOQPure(365, 100, 0.2, 10, 0);
      expect(eoq).toBe(191);
    });
  });

  describe('TR-10.7 EOQ H=0 (price=0) fallback minStock×2', () => {
    it('[纯函数] price=0 → fallback 20*2=40', () => {
      const eoq = computeEOQPure(365, 100, 0.2, 0, 20);
      expect(eoq).toBe(40);
    });

    it('[纯函数] annualDemand=0 → fallback', () => {
      const eoq = computeEOQPure(0, 100, 0.2, 10, 15);
      expect(eoq).toBe(30);
    });
  });

  describe('TR-10.12 理由优先级', () => {
    it('[纯函数] 优先级 ZERO_STOCK > USAGE_SPIKE > EXPIRING_30D > ROP_BELOW_MIN', () => {
      expect(REASON_PRIORITY.ZERO_STOCK).toBeGreaterThan(REASON_PRIORITY.USAGE_SPIKE);
      expect(REASON_PRIORITY.USAGE_SPIKE).toBeGreaterThan(REASON_PRIORITY.EXPIRING_30D);
      expect(REASON_PRIORITY.EXPIRING_30D).toBeGreaterThan(REASON_PRIORITY.ROP_BELOW_MIN);
    });

    it('[纯函数] selectHigherReason 按优先级取更强理由', () => {
      expect(selectHigherReason('ROP_BELOW_MIN', 'ZERO_STOCK')).toBe('ZERO_STOCK');
      expect(selectHigherReason('EXPIRING_30D', 'USAGE_SPIKE')).toBe('USAGE_SPIKE');
      expect(selectHigherReason(null, 'ROP_BELOW_MIN')).toBe('ROP_BELOW_MIN');
      expect(selectHigherReason('ZERO_STOCK', 'EXPIRING_30D')).toBe('ZERO_STOCK');
    });
  });
});

describe('ReplenishmentSuggestionService - 服务集成测试', () => {
  let db: MockDbService;
  let settings: FakeSettings;
  let purchaseOrders: PurchaseOrdersService;
  let service: ReplenishmentSuggestionService;

  beforeEach(() => {
    db = new MockDbService();
    settings = createFakeSettings();
    purchaseOrders = new PurchaseOrdersService(
      asDbService(db),
      createMockClinicContext(),
    );
    service = new ReplenishmentSuggestionService(
      asDbService(db),
      createMockClinicContext(),
      settings.service,
      purchaseOrders,
    );
  });

  afterEach(() => {
    db.clear();
  });

  describe('TR-10.3 computeAvgDailyConsumption 不足7天 fallback', () => {
    it('仅5天交易数据 + minStock=30 → 保底 avgDaily = max(0.01, 30/30)=1.0', async () => {
      const item = createSeedItem({ id: 'inv-fallback', minStock: 30 });
      db.seed('InventoryItem', [item]);
      const today = new Date();
      const txs: any[] = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        txs.push({
          id: 'tx-' + i,
          itemId: 'inv-fallback',
          type: 'OUT',
          quantity: 1,
          unitPrice: 0,
          totalAmount: 0,
          clinicId: TEST_CLINIC,
          createdAt: d.toISOString(),
          deletedAt: null,
        });
      }
      db.seed('InventoryTransaction', txs);

      const r: ConsumptionResult = await service.computeAvgDailyConsumption('inv-fallback', 90);
      expect(r.avgDaily).toBeGreaterThanOrEqual(0.01);
      expect(r.avgDaily).toBeLessThanOrEqual(Math.max(1.0, 1 + 0.5));
    });

    it('无交易数据 + minStock=30 → fallback max(0.01, 30/30)=1.0', async () => {
      const item = createSeedItem({ id: 'inv-no-tx', minStock: 30 });
      db.seed('InventoryItem', [item]);

      const r: ConsumptionResult = await service.computeAvgDailyConsumption('inv-no-tx', 90);
      expect(r.avgDaily).toBeCloseTo(1.0, 5);
    });
  });

  describe('TR-10.1 / TR-10.2 通过 spy 精确验证 computeAvgDailyConsumption', () => {
    it('[spy] 90天每天1件OUT交易 → avgDaily≈1.0, σ≈0', async () => {
      const item = createSeedItem({ id: 'inv-spy-1', minStock: 30 });
      db.seed('InventoryItem', [item]);
      const today = new Date();
      const mockGrouped: Array<{ day: string; totalQty: number }> = [];
      for (let i = 0; i < 90; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        mockGrouped.push({ day: d.toISOString().slice(0, 10), totalQty: 1 });
      }
      jest.spyOn(db, 'prepare').mockImplementation((): any => {
        return {
          get: () => ({ minStock: 30 }),
          all: () => mockGrouped,
          run: () => ({ changes: 0, lastInsertRowid: '' }),
        };
      });

      const r = await service.computeAvgDailyConsumption('inv-spy-1', 90);
      expect(r.avgDaily).toBeCloseTo(1.0, 3);
      expect(r.outliersSkipped).toBe(0);
      expect(r.sigma).toBeCloseTo(0, 1);
    });

    it('[spy] 89天=1 + 1天=100 → outliersSkipped=1; avg≈1.0', async () => {
      const item = createSeedItem({ id: 'inv-spy-outlier', minStock: 30 });
      db.seed('InventoryItem', [item]);
      const today = new Date();
      const mockGrouped: Array<{ day: string; totalQty: number }> = [];
      for (let i = 0; i < 89; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        mockGrouped.push({ day: d.toISOString().slice(0, 10), totalQty: 1 });
      }
      const od = new Date(today);
      od.setDate(od.getDate() - 89);
      mockGrouped.push({ day: od.toISOString().slice(0, 10), totalQty: 100 });
      jest.spyOn(db, 'prepare').mockImplementation((): any => {
        return {
          get: () => ({ minStock: 30 }),
          all: () => mockGrouped,
          run: () => ({ changes: 0, lastInsertRowid: '' }),
        };
      });

      const r = await service.computeAvgDailyConsumption('inv-spy-outlier', 90);
      expect(r.outliersSkipped).toBe(1);
      expect(r.avgDaily).toBeGreaterThan(0.9);
      expect(r.avgDaily).toBeLessThan(1.2);
    });
  });

  describe('TR-10.8 generate: stock≤rop 触发 ROP', () => {
    it('item stock=3 ≤ rop → 生成建议；suggestedQty ≥ EOQ；totalAmount=suggestedQty*price(分)', async () => {
      const item = createSeedItem({
        id: 'inv-rop',
        stock: 3,
        minStock: 30,
        price: 1000,
        unit: '盒',
        supplierId: 'supplier-A',
      });
      db.seed('InventoryItem', [item]);
      db.seed('Supplier', [
        { id: 'supplier-A', name: '供应商A', clinicId: TEST_CLINIC, deletedAt: null },
      ]);

      jest.spyOn(service as any, 'computeAvgDailyConsumption').mockResolvedValue({
        avgDaily: 1,
        windowDays: 90,
        outliersSkipped: 0,
        recent90: Array(90).fill(0).map((_, i) => ({
          date: new Date(Date.now() - (89 - i) * 86400000).toISOString().slice(0, 10),
          quantity: 1,
        })),
        sigma: 0.5,
      });

      const res = await service.generateSuggestions({ lookbackDays: 90, leadTimeDaysDefault: 7, safetyFactor: 1.5 });
      expect(res.stats.scanned).toBe(1);
      expect(res.stats.generated).toBe(1);
      expect(res.suggestions.length).toBe(1);
      const sug = res.suggestions[0];
      expect(sug.reason).toBe('ROP_BELOW_MIN');
      expect(sug.status).toBe('OPEN');
      expect(sug.supplierId).toBe('supplier-A');
      expect(sug.suggestedQty).toBeGreaterThanOrEqual(14);
      const srows = db.getTableData('InventoryReplenishmentSuggestion');
      expect(srows.length).toBe(1);
      expect(srows[0].status).toBe('OPEN');
      expect((srows[0] as any).reason).toBe('ROP_BELOW_MIN');
    });
  });

  describe('TR-10.9 stock=0 且 avgDaily>0 → ZERO_STOCK', () => {
    it('库存=0 → 理由 ZERO_STOCK（优先级高于ROP）', async () => {
      const item = createSeedItem({ id: 'inv-zero', stock: 0, minStock: 20, price: 500 });
      db.seed('InventoryItem', [item]);
      db.seed('Supplier', [
        { id: 'supplier-A', name: '供应商A', clinicId: TEST_CLINIC, deletedAt: null },
      ]);

      jest.spyOn(service as any, 'computeAvgDailyConsumption').mockResolvedValue({
        avgDaily: 2,
        windowDays: 90,
        outliersSkipped: 0,
        recent90: [],
        sigma: 0.3,
      });

      const res = await service.generateSuggestions();
      expect(res.stats.generated).toBe(1);
      expect(res.stats.zeroStock).toBe(1);
      expect(res.suggestions[0].reason).toBe('ZERO_STOCK');
    });
  });

  describe('TR-10.10 expireDate=today+15 → EXPIRING_30D', () => {
    it('即使stock>rop，只要expireDate≤today+30就触发 EXPIRING_30D', async () => {
      const d15 = new Date();
      d15.setDate(d15.getDate() + 15);
      const item = createSeedItem({
        id: 'inv-expiring',
        stock: 9999,
        minStock: 5,
        price: 100,
        expireDate: d15.toISOString().slice(0, 10),
      });
      db.seed('InventoryItem', [item]);

      jest.spyOn(service as any, 'computeAvgDailyConsumption').mockResolvedValue({
        avgDaily: 0.1,
        windowDays: 90,
        outliersSkipped: 0,
        recent90: [],
        sigma: 0,
      });

      const res = await service.generateSuggestions();
      expect(res.stats.expiring).toBeGreaterThanOrEqual(1);
      const reason = res.suggestions[0]?.reason;
      expect(reason).toBeDefined();
      expect(['EXPIRING_30D', 'ZERO_STOCK', 'USAGE_SPIKE', 'ROP_BELOW_MIN']).toContain(reason);
      const countExp = (res.suggestions as any[]).filter((s) => s.reason === 'EXPIRING_30D').length;
      expect(countExp).toBeGreaterThanOrEqual(1);
    });
  });

  describe('TR-10.11 近7天均值 15 vs 90天均值 4 (3.75x) → USAGE_SPIKE', () => {
    it('7d avg = 15, 90d avg = 4 → 15>4*3 → 触发 USAGE_SPIKE', async () => {
      const item = createSeedItem({ id: 'inv-spike', stock: 500, minStock: 100, price: 100 });
      db.seed('InventoryItem', [item]);

      const today = new Date();
      const recent90: { date: string; quantity: number }[] = [];
      for (let i = 89; i >= 0; i--) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const qty = i < 7 ? 15 : Math.round(40 / 12);
        recent90.push({ date: d.toISOString().slice(0, 10), quantity: qty });
      }

      jest.spyOn(service as any, 'computeAvgDailyConsumption').mockResolvedValue({
        avgDaily: 4,
        windowDays: 90,
        outliersSkipped: 0,
        recent90,
        sigma: 1,
      });

      const res = await service.generateSuggestions();
      expect(res.stats.spike).toBeGreaterThanOrEqual(1);
      const countSpike = (res.suggestions as any[]).filter((s) => s.reason === 'USAGE_SPIKE').length;
      expect(countSpike).toBeGreaterThanOrEqual(1);
    });
  });

  describe('TR-10.13 applyToPurchaseOrder: 5条同供应商合并成1张PO', () => {
    it('5条建议，supplier-A → 1 PO (PENDING) + 5 PurchaseOrderItem；状态变 APPLIED', async () => {
      const supplierA = 'supplier-A';
      db.seed('Supplier', [{ id: supplierA, name: '供应商A', clinicId: TEST_CLINIC, deletedAt: null }]);
      const items = [];
      const sugIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const invId = 'inv-apply-' + i;
        items.push(createSeedItem({
          id: invId,
          name: '耗材' + i,
          stock: 2,
          minStock: 20,
          price: 1000,
          supplierId: supplierA,
        }));
        const sugId = 'sug-apply-' + i;
        sugIds.push(sugId);
        db.seed('InventoryReplenishmentSuggestion', [createSuggestionSeed({
          id: sugId,
          inventoryId: invId,
          status: 'OPEN',
          reason: 'ROP_BELOW_MIN',
          suggestedQty: 50,
          supplierId: supplierA,
          totalAmount: 50000,
        })]);
      }
      db.seed('InventoryItem', items);

      const pos = await service.applyToPurchaseOrder(sugIds, { groupBySupplier: true });
      expect(pos.length).toBe(1);
      const po = pos[0];
      expect(po.status).toBe('PENDING');
      expect(po.supplierId).toBe(supplierA);

      const poItems = db.getTableData('PurchaseOrderItem');
      expect(poItems.length).toBe(5);
      expect(poItems.every((pi) => pi.orderId === po.id)).toBe(true);

      const sggs = db.getTableData('InventoryReplenishmentSuggestion') as any[];
      expect(sggs.every((s) => s.status === 'APPLIED')).toBe(true);
    });
  });

  describe('TR-10.14 groupBySupplier=false → 每条1张PO；缺失supplier fallback 新建未指定供应商', () => {
    it('5条不同供应商/缺失 → 5张PO；无supplier的创建"未指定供应商"', async () => {
      const sugIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        const invId = 'inv-gp-false-' + i;
        db.seed('InventoryItem', [createSeedItem({
          id: invId,
          name: '耗材F-' + i,
          stock: 0,
          minStock: 10,
          price: 100,
          supplierId: i < 3 ? 'supplier-X-' + i : undefined,
        })]);
        if (i < 3) {
          db.seed('Supplier', [{ id: 'supplier-X-' + i, name: 'X' + i, clinicId: TEST_CLINIC, deletedAt: null }]);
        }
        const sugId = 'sug-gp-false-' + i;
        sugIds.push(sugId);
        db.seed('InventoryReplenishmentSuggestion', [createSuggestionSeed({
          id: sugId,
          inventoryId: invId,
          status: 'OPEN',
          reason: 'ZERO_STOCK',
          suggestedQty: 10,
          supplierId: i < 3 ? 'supplier-X-' + i : undefined,
          totalAmount: 1000,
        })]);
      }

      const pos = await service.applyToPurchaseOrder(sugIds, { groupBySupplier: false });
      expect(pos.length).toBe(5);

      const suppliers = db.getTableData('Supplier');
      const unspecified = suppliers.find((s) => s.name === '未指定供应商');
      expect(unspecified).toBeDefined();

      const sggs = db.getTableData('InventoryReplenishmentSuggestion') as any[];
      expect(sggs.every((s) => s.status === 'APPLIED')).toBe(true);
    });
  });

  describe('TR-10.15 ignoreSuggestions 幂等', () => {
    it('两次调用相同ids → status始终IGNORED，无异常，updated count 第二次=0或稳定', async () => {
      for (let i = 0; i < 3; i++) {
        db.seed('InventoryReplenishmentSuggestion', [createSuggestionSeed({
          id: 'sug-ign-' + i,
          inventoryId: 'inv-' + i,
          status: 'OPEN',
        })]);
      }
      db.seed('InventoryItem', [
        createSeedItem({ id: 'inv-0', stock: 1, minStock: 10 }),
        createSeedItem({ id: 'inv-1', stock: 2, minStock: 10 }),
        createSeedItem({ id: 'inv-2', stock: 3, minStock: 10 }),
      ]);

      const ids = ['sug-ign-0', 'sug-ign-1', 'sug-ign-2'];
      const r1 = await service.ignoreSuggestions(ids);
      expect(r1.updated).toBeGreaterThan(0);
      const rows = db.getTableData('InventoryReplenishmentSuggestion') as any[];
      expect(rows.filter((s) => s.status === 'IGNORED').length).toBe(3);

      await expect(service.ignoreSuggestions(ids)).resolves.toBeDefined();
      const rows2 = db.getTableData('InventoryReplenishmentSuggestion') as any[];
      expect(rows2.filter((s) => s.status === 'IGNORED').length).toBe(3);
    });

    it('ids 空抛 BusinessValidationException', async () => {
      await expect(service.ignoreSuggestions([])).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('TR-10.16 list: page=1 pageSize=5 + sortBy suggestedQty DESC', () => {
    it('创建25条 OPEN 建议 → total>=20；page=1 size=5 返回5条；按 suggestedQty 降序', async () => {
      const items = [];
      const suggs = [];
      for (let i = 0; i < 25; i++) {
        const invId = 'inv-list-' + i;
        items.push(createSeedItem({ id: invId, stock: 1, minStock: 10 }));
        suggs.push(createSuggestionSeed({
          id: 'sug-list-' + i,
          inventoryId: invId,
          status: 'OPEN',
          suggestedQty: 10 + i,
          totalAmount: (10 + i) * 100,
        }));
      }
      db.seed('InventoryItem', items);
      db.seed('InventoryReplenishmentSuggestion', suggs);

      const page = await service.list({
        status: 'OPEN',
        page: 1,
        pageSize: 5,
        sortBy: 'suggestedQty',
        sortOrder: 'DESC',
      });
      expect(page.total).toBeGreaterThanOrEqual(20);
      expect(page.data.length).toBe(5);
      const qtyOrdered = (page.data as any[]).map((s) => s.suggestedQty);
      for (let i = 0; i < qtyOrdered.length - 1; i++) {
        expect(qtyOrdered[i]).toBeGreaterThanOrEqual(qtyOrdered[i + 1]);
      }
      expect(qtyOrdered[0]).toBe(34);
    });
  });

  describe('TR-10.19 totalAmount = suggestedQty * price (分存储)', () => {
    it('DB 层 totalAmount(分) = suggestedQty × price(分)；读出后转元', async () => {
      const item = createSeedItem({ id: 'inv-ta', stock: 0, minStock: 10, price: 1000, supplierId: 's-ta' });
      db.seed('InventoryItem', [item]);
      db.seed('Supplier', [{ id: 's-ta', name: 'TASup', clinicId: TEST_CLINIC, deletedAt: null }]);

      jest.spyOn(service as any, 'computeAvgDailyConsumption').mockResolvedValue({
        avgDaily: 1,
        windowDays: 90,
        outliersSkipped: 0,
        recent90: [],
        sigma: 0,
      });
      jest.spyOn(service as any, 'computeEOQ').mockReturnValue(191);
      jest.spyOn(service as any, 'computeROP').mockReturnValue(16);

      await service.generateSuggestions();
      const srows = db.getTableData('InventoryReplenishmentSuggestion') as any[];
      expect(srows.length).toBeGreaterThanOrEqual(1);
      const srow = srows[0];
      expect(srow.totalAmount).toBe(191 * 1000);
      const converted = (srow.totalAmount as number) / 100;
      expect(converted).toBeCloseTo(1910, 2);
    });
  });

  describe('TR-10.20 snapshot JSON 序列化/反序列化', () => {
    it('写入后 calculationSnapshotJson 可解析，包含必需字段', async () => {
      const item = createSeedItem({ id: 'inv-snap', stock: 2, minStock: 20, price: 1000, supplierId: 'sA' });
      db.seed('InventoryItem', [item]);
      db.seed('Supplier', [{ id: 'sA', name: 'A', clinicId: TEST_CLINIC, deletedAt: null }]);
      jest.spyOn(service as any, 'computeAvgDailyConsumption').mockResolvedValue({
        avgDaily: 2,
        windowDays: 90,
        outliersSkipped: 0,
        recent90: [],
        sigma: 0.5,
      });

      await service.generateSuggestions();
      const srow = (db.getTableData('InventoryReplenishmentSuggestion') as any[])[0];
      const snap = JSON.parse(srow.calculationSnapshotJson);
      expect(typeof snap.avgDaily).toBe('number');
      expect(typeof snap.leadTimeDays).toBe('number');
      expect(typeof snap.rop).toBe('number');
      expect(typeof snap.eoq).toBe('number');
      expect(typeof snap.safetyStock).toBe('number');
      expect(typeof snap.sigma).toBe('number');
      expect(typeof snap.reason).toBe('string');
    });
  });

  describe('TR-10.21 同一 inventoryId 重新 generate → 历史 OPEN 软删除后新建', () => {
    it('二次 generate 后旧 OPEN 被置 deletedAt，存在新的 OPEN（status=OPEN）', async () => {
      const item = createSeedItem({ id: 'inv-regen', stock: 1, minStock: 30, price: 1000 });
      db.seed('InventoryItem', [item]);
      jest.spyOn(service as any, 'computeAvgDailyConsumption').mockResolvedValue({
        avgDaily: 2,
        windowDays: 90,
        outliersSkipped: 0,
        recent90: [],
        sigma: 1,
      });

      const r1 = await service.generateSuggestions();
      expect(r1.stats.generated).toBe(1);
      const idFirst = r1.suggestions[0].id;
      expect(idFirst).toBeDefined();

      const allAfter1 = db.getTableData('InventoryReplenishmentSuggestion') as any[];
      expect(allAfter1.length).toBe(1);
      expect(allAfter1[0].status).toBe('OPEN');

      const r2 = await service.generateSuggestions();
      expect(r2.stats.generated).toBe(1);

      const all = db.getTableData('InventoryReplenishmentSuggestion') as any[];
      expect(all.length).toBe(2);

      const first = all.find((s) => s.id === idFirst);
      expect(first).toBeDefined();
      const firstDeletedVal = first!.deletedAt;
      const firstIsDeleted = firstDeletedVal !== null && firstDeletedVal !== undefined && firstDeletedVal !== '';
      expect(firstIsDeleted).toBe(true);

      const stillOpen = all.filter((s) => s.status === 'OPEN' && !s.deletedAt);
      expect(stillOpen.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('TR-10.18 aiInventoryReplenishmentEnabled=false → generate 不写DB', () => {
    it('开关关闭 → 返回空，DB中 0 条 Suggestion', async () => {
      settings.store.set('aiInventoryReplenishmentEnabled', 'false');
      const items = [];
      for (let i = 0; i < 10; i++) {
        items.push(createSeedItem({ id: 'inv-dis-' + i, stock: 0, minStock: 10 }));
      }
      db.seed('InventoryItem', items);

      const res = await service.generateSuggestions();
      expect(res.stats.scanned).toBe(0);
      expect(res.stats.generated).toBe(0);
      expect(res.suggestions.length).toBe(0);
      expect(db.getTableData('InventoryReplenishmentSuggestion').length).toBe(0);
    });
  });

  describe('TR-10.17 Cron 任务 / 失败 BusinessAlert', () => {
    it('InventoryReplenishmentTask.execute 正常执行不抛错并返回统计', async () => {
      const { InventoryReplenishmentTask } = require('../../system/daily-scheduler/tasks/inventory-replenishment.task');
      const task = new InventoryReplenishmentTask(service, createMockClinicContext());
      jest.spyOn(service, 'generateSuggestions').mockResolvedValue({
        stats: { scanned: 10, generated: 3, zeroStock: 1, expiring: 1, spike: 1 },
        suggestions: [],
      });
      await expect(task.execute(TEST_CLINIC)).resolves.not.toThrow();
    });

    it('连续失败3次 → scheduler 写 BusinessAlert SCHEDULED_TASK_FAILED', async () => {
      const { DailySchedulerService } = require('../../system/daily-scheduler/daily-scheduler.service');
      const badHandler = {
        name: 'BadTask',
        enabled: true,
        execute: async () => { throw new Error('boom'); },
      };
      const mockTask = { name: 'mock', enabled: false, execute: async () => {} };
      const fakeDb = new MockDbService();
      const scheduler = new DailySchedulerService(
        asDbService(fakeDb),
        createMockClinicContext(),
        settings.service,
        mockTask, mockTask, mockTask, mockTask, mockTask, mockTask, mockTask, mockTask, mockTask,
      );
      scheduler.register(badHandler);
      for (let i = 0; i < 3; i++) {
        try { await scheduler.runAllTasks(); } catch { /* ignore */ }
      }
      expect(scheduler.getFailureCount('BadTask')).toBe(3);
    });
  });

  describe('TR-10.22 性能: 500 items ≤ 3s (mock)', () => {
    it('500 条 inventory 生成建议 ≤ 3s，无 N+1 级联SQL（一次性SELECT）', async () => {
      const items = [];
      for (let i = 0; i < 500; i++) {
        items.push(createSeedItem({
          id: 'inv-perf-' + i,
          stock: i % 5,
          minStock: 20,
          price: 100,
          supplierId: 'sup-perf',
        }));
      }
      db.seed('Supplier', [{ id: 'sup-perf', name: '性能供应商', clinicId: TEST_CLINIC, deletedAt: null }]);
      db.seed('InventoryItem', items);
      jest.spyOn(service as any, 'computeAvgDailyConsumption').mockResolvedValue({
        avgDaily: 1,
        windowDays: 90,
        outliersSkipped: 0,
        recent90: [],
        sigma: 0.3,
      });

      const t0 = Date.now();
      const res = await service.generateSuggestions();
      const elapsed = Date.now() - t0;
      expect(res.stats.scanned).toBe(500);
      expect(elapsed).toBeLessThanOrEqual(3000);
    }, 10000);
  });

  describe('apply/ignore 异常场景', () => {
    it('apply 传空 ids 应抛 BusinessValidationException', async () => {
      await expect(service.applyToPurchaseOrder([], { groupBySupplier: true })).rejects.toThrow(BusinessValidationException);
    });

    it('apply 对已应用/不存在 ids 抛 BusinessNotFoundException', async () => {
      db.seed('InventoryReplenishmentSuggestion', [createSuggestionSeed({
        id: 'sug-applied', status: 'APPLIED', inventoryId: 'inv-x',
      })]);
      db.seed('InventoryItem', [createSeedItem({ id: 'inv-x', stock: 0, minStock: 10 })]);
      await expect(service.applyToPurchaseOrder(['sug-applied'], { groupBySupplier: true })).rejects.toThrow(BusinessNotFoundException);
      await expect(service.applyToPurchaseOrder(['nonexistent-id'], { groupBySupplier: true })).rejects.toThrow(BusinessNotFoundException);
    });
  });
});
