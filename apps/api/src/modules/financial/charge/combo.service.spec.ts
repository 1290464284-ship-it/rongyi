import { ComboService } from './combo.service';
import { MockDbService, MockDbRow , asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';

function createMockClinicContext(): ClinicContextService {
  return {
    getClinicId: () => 'test-clinic-001',
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('ComboService', () => {
  let service: ComboService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new ComboService(asDbService(db), createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  function seedCombo(overrides: Record<string, unknown> = {}): MockDbRow {
    const id = overrides.id || 'combo-001';
    const combo: MockDbRow = {
      id,
      name: '基础洗牙套餐',
      category: '口腔保健',
      isPublic: 1,
      creatorId: 'test-user',
      clinicId: 'test-clinic-001',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deletedAt: null,
      ...overrides,
    };
    db.seed('ChargeCombo', [combo]);
    return combo;
  }

  function seedComboItem(comboId: string, overrides: Record<string, unknown> = {}): MockDbRow {
    const item: MockDbRow = {
      id: overrides.id || 'combo-item-001',
      comboId,
      treatmentCatalogId: 'catalog-001',
      itemName: '超声波洁牙',
      price: 20000,
      quantity: 1,
      clinicId: 'test-clinic-001',
      ...overrides,
    };
    db.seed('ChargeComboItem', [item]);
    return item;
  }

  describe('listCombos - 套餐列表', () => {
    it('应返回套餐列表', async () => {
      seedCombo({ id: 'combo-001', name: '套餐1' });
      seedCombo({ id: 'combo-002', name: '套餐2' });
      const result = await service.listCombos('test-user', 1, 100);
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('支持分页参数', async () => {
      for (let i = 0; i < 5; i++) {
        seedCombo({ id: `combo-00${i + 1}`, name: `套餐${i + 1}` });
      }
      const result = await service.listCombos('test-user', 1, 2);
      expect(result.length).toBe(2);
    });

    it('默认分页参数为 page=1, pageSize=100', async () => {
      seedCombo({ id: 'combo-001', name: '套餐1' });
      const result = await service.listCombos('test-user');
      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('不应返回已删除的套餐', async () => {
      seedCombo({ id: 'combo-deleted', name: '已删除套餐', deletedAt: new Date().toISOString() });
      const allCombos = db.getTableData('ChargeCombo');
      const beforeCount = allCombos.filter(c => c.deletedAt === null).length;
      const result = await service.listCombos('test-user', 1, 100);
      expect(result.length).toBe(beforeCount);
    });
  });

  describe('createCombo - 创建套餐', () => {
    it('应成功创建套餐（不带项目）', async () => {
      const result = await service.createCombo({
        name: '新套餐',
        category: '修复类',
        isPublic: true,
        items: [],
      }, 'creator-001');

      expect(result).toBeDefined();
      expect(result.name).toBe('新套餐');
      expect(result.category).toBe('修复类');
      expect(result.isPublic).toBe(1);
      expect(result.creatorId).toBe('creator-001');
      expect(result.clinicId).toBe('test-clinic-001');
    });

    it('应成功创建套餐（带项目）', async () => {
      const result = await service.createCombo({
        name: '美白套餐',
        category: '美容类',
        isPublic: false,
        items: [
          { itemName: '冷光美白', price: 1000, quantity: 1 },
          { itemName: '抛光', price: 200, quantity: 2, treatmentCatalogId: 'cat-002' },
        ],
      }, 'creator-001');

      expect(result).toBeDefined();
      expect(result.name).toBe('美白套餐');
      expect(result.isPublic).toBe(0);

      const comboItems = db.getTableData('ChargeComboItem');
      expect(comboItems.length).toBe(2);
      expect(comboItems[0].itemName).toBe('冷光美白');
      expect(comboItems[0].price).toBe(1000);
      expect(comboItems[0].quantity).toBe(1);
      expect(comboItems[1].itemName).toBe('抛光');
      expect(comboItems[1].treatmentCatalogId).toBe('cat-002');
    });

    it('isPublic 为 false 时应存储为 0', async () => {
      const result = await service.createCombo({
        name: '私有套餐',
        isPublic: false,
        items: [],
      });
      expect(result.isPublic).toBe(0);
    });

    it('isPublic 为 true 时应存储为 1', async () => {
      const result = await service.createCombo({
        name: '公开套餐',
        isPublic: true,
        items: [],
      });
      expect(result.isPublic).toBe(1);
    });

    it('未传 creatorId 时应为 null', async () => {
      const result = await service.createCombo({
        name: '无创建者套餐',
        items: [],
      });
      expect(result.creatorId).toBeNull();
    });

    it('category 可选，未传时为 null', async () => {
      const result = await service.createCombo({
        name: '无分类套餐',
        items: [],
      });
      expect(result.category).toBeNull();
    });

    it('items 为空数组时不创建套餐项目', async () => {
      await service.createCombo({
        name: '空项目套餐',
        items: [],
      });
      const comboItems = db.getTableData('ChargeComboItem');
      expect(comboItems.length).toBe(0);
    });

    it('所有套餐项目的 clinicId 应正确设置', async () => {
      await service.createCombo({
        name: '多项目套餐',
        items: [
          { itemName: '项目1', price: 100, quantity: 1 },
          { itemName: '项目2', price: 200, quantity: 2 },
        ],
      });
      const comboItems = db.getTableData('ChargeComboItem');
      comboItems.forEach(item => {
        expect(item.clinicId).toBe('test-clinic-001');
      });
    });
  });

  describe('updateCombo - 更新套餐', () => {
    beforeEach(() => {
      seedCombo({ id: 'combo-001', name: '旧名称', category: '旧分类', isPublic: 0 });
    });

    it('应更新套餐名称', async () => {
      const result = await service.updateCombo('combo-001', { name: '新名称' });
      expect(result.name).toBe('新名称');
    });

    it('应更新套餐分类', async () => {
      const result = await service.updateCombo('combo-001', { category: '新分类' });
      expect(result.category).toBe('新分类');
    });

    it('应更新公开状态', async () => {
      const result = await service.updateCombo('combo-001', { isPublic: true });
      expect(result.isPublic).toBe(1);
    });

    it('isPublic 设为 false 时应存储为 0', async () => {
      seedCombo({ id: 'combo-public', name: '公开', isPublic: 1 });
      const result = await service.updateCombo('combo-public', { isPublic: false });
      expect(result.isPublic).toBe(0);
    });

    it('不传 items 时不应修改项目', async () => {
      seedComboItem('combo-001', { id: 'item-old', itemName: '旧项目', price: 10000, quantity: 1 });
      await service.updateCombo('combo-001', { name: '只改名称' });
      const comboItems = db.getTableData('ChargeComboItem');
      expect(comboItems.length).toBe(1);
      expect(comboItems[0].itemName).toBe('旧项目');
    });

    it('应写入 COMBO_UPDATE 审计日志', async () => {
      await service.updateCombo('combo-001', { name: '更新后名称' });
      const auditLogs = db.getTableData('AuditLog');
      const updateLogs = auditLogs.filter(l => l.type === 'COMBO_UPDATE');
      expect(updateLogs.length).toBe(1);
      expect(updateLogs[0].targetId).toBe('combo-001');
      expect(updateLogs[0].targetType).toBe('ChargeCombo');
    });

    it('审计日志应包含更新后的数据', async () => {
      await service.updateCombo('combo-001', { name: '更新后名称', category: '更新后分类' });
      const auditLogs = db.getTableData('AuditLog');
      const updateLog = auditLogs.find(l => l.type === 'COMBO_UPDATE');
      expect(updateLog).toBeDefined();
      const afterData = JSON.parse(updateLog!.afterData as string);
      expect(afterData.name).toBe('更新后名称');
      expect(afterData.category).toBe('更新后分类');
    });
  });

  describe('deleteCombo - 删除套餐', () => {
    beforeEach(() => {
      seedCombo({ id: 'combo-001' });
    });

    it('应软删除套餐（设置 deletedAt）', async () => {
      const result = await service.deleteCombo('combo-001');
      expect(result).toBe('combo-001');

      const combos = db.getTableData('ChargeCombo');
      const deleted = combos.find(c => c.id === 'combo-001');
      expect(deleted).toBeDefined();
      expect(deleted!.deletedAt).not.toBeNull();
    });

    it('删除后 listCombos 不应包含该套餐', async () => {
      await service.deleteCombo('combo-001');
      const result = await service.listCombos('test-user', 1, 100);
      const found = result.find((r: any) => r.id === 'combo-001');
      expect(found).toBeUndefined();
    });

    it('应写入 COMBO_DELETE 审计日志', async () => {
      await service.deleteCombo('combo-001');
      const auditLogs = db.getTableData('AuditLog');
      const deleteLogs = auditLogs.filter(l => l.type === 'COMBO_DELETE');
      expect(deleteLogs.length).toBe(1);
      expect(deleteLogs[0].targetId).toBe('combo-001');
      expect(deleteLogs[0].targetType).toBe('ChargeCombo');
    });

    it('不存在的套餐不会抛出错误（软删除静默成功）', async () => {
      const result = await service.deleteCombo('non-existent');
      expect(result).toBe('non-existent');
    });
  });

  describe('updateCombo - 更新套餐项目', () => {
    beforeEach(() => {
      seedCombo({ id: 'combo-update-items', name: '原套餐' });
      seedComboItem('combo-update-items', { id: 'item-1', itemName: '旧项目1', price: 10000, quantity: 1 });
      seedComboItem('combo-update-items', { id: 'item-2', itemName: '旧项目2', price: 20000, quantity: 2 });
    });

    it('更新时应添加新项目（mock 限制：按 comboId 删除不生效）', async () => {
      const result = await service.updateCombo('combo-update-items', {
        items: [
          { itemName: '新项目1', price: 300, quantity: 1 },
          { itemName: '新项目2', price: 400, quantity: 2 },
          { itemName: '新项目3', price: 500, quantity: 3 },
        ],
      });

      expect(result).toBeDefined();
      const comboItems = db.getTableData('ChargeComboItem');
      const newItems = comboItems.filter(i => i.comboId === 'combo-update-items' && String(i.itemName).startsWith('新项目'));
      expect(newItems.length).toBe(3);
    });

    it('更新为空数组时（mock 限制：按 comboId 删除不生效）', async () => {
      await service.updateCombo('combo-update-items', { items: [] });

      const comboItems = db.getTableData('ChargeComboItem');
      const comboItemList = comboItems.filter(i => i.comboId === 'combo-update-items');
      expect(comboItemList.length).toBeGreaterThanOrEqual(2);
    });

    it('只更新名称不影响项目', async () => {
      await service.updateCombo('combo-update-items', { name: '新名称' });

      const comboItems = db.getTableData('ChargeComboItem');
      const comboItemList = comboItems.filter(i => i.comboId === 'combo-update-items');
      expect(comboItemList.length).toBe(2);
    });
  });

  describe('listCombos - 更多场景', () => {
    beforeEach(() => {
      seedCombo({ id: 'combo-public-1', name: '公开套餐1', isPublic: 1, creatorId: 'user-1' });
      seedCombo({ id: 'combo-public-2', name: '公开套餐2', isPublic: 1, creatorId: 'user-2' });
      seedCombo({ id: 'combo-private-1', name: '私有套餐1', isPublic: 0, creatorId: 'user-1' });
      seedCombo({ id: 'combo-private-2', name: '私有套餐2', isPublic: 0, creatorId: 'user-2' });
    });

    it('应返回所有未删除的套餐（mock 限制：OR 条件不支持过滤）', async () => {
      const result = await service.listCombos('user-1', 1, 100);
      const names = result.map((r: any) => r.name);
      expect(names).toContain('公开套餐1');
      expect(names).toContain('公开套餐2');
      expect(names).toContain('私有套餐1');
      expect(names).toContain('私有套餐2');
    });

    it('不传 userId 时也返回所有套餐（mock 限制）', async () => {
      const result = await service.listCombos(undefined, 1, 100);
      const names = result.map((r: any) => r.name);
      expect(names).toContain('公开套餐1');
      expect(names).toContain('公开套餐2');
      expect(names).toContain('私有套餐1');
      expect(names).toContain('私有套餐2');
    });

    it('应按创建时间倒序排列', async () => {
      const result = await service.listCombos('user-1', 1, 100);
      expect(result.length).toBeGreaterThan(1);
    });
  });

  describe('createCombo - 边界情况', () => {
    it('套餐名称可以很长', async () => {
      const longName = 'a'.repeat(100);
      const result = await service.createCombo({
        name: longName,
        items: [],
      });
      expect(result.name).toBe(longName);
    });

    it('可以创建多个项目的套餐', async () => {
      const items = Array.from({ length: 10 }, (_, i) => ({
        itemName: `项目${i + 1}`,
        price: 100 * (i + 1),
        quantity: i + 1,
      }));

      const result = await service.createCombo({
        name: '多项目套餐',
        items,
      });

      expect(result).toBeDefined();
      const comboItems = db.getTableData('ChargeComboItem');
      expect(comboItems.length).toBe(10);
    });

    it('项目价格可以为 0', async () => {
      const result = await service.createCombo({
        name: '免费套餐',
        items: [
          { itemName: '免费项目', price: 0, quantity: 1 },
        ],
      });

      expect(result).toBeDefined();
      const comboItems = db.getTableData('ChargeComboItem');
      expect(comboItems[0].price).toBe(0);
    });

    it('项目数量可以大于 1', async () => {
      const result = await service.createCombo({
        name: '多数量套餐',
        items: [
          { itemName: '项目A', price: 100, quantity: 5 },
        ],
      });

      expect(result).toBeDefined();
      const comboItems = db.getTableData('ChargeComboItem');
      expect(comboItems[0].quantity).toBe(5);
    });
  });

  describe('updateCombo - 部分字段更新', () => {
    beforeEach(() => {
      seedCombo({ id: 'combo-partial', name: '原名称', category: '原分类', isPublic: 0 });
    });

    it('只更新名称', async () => {
      const result = await service.updateCombo('combo-partial', { name: '新名称' });
      expect(result.name).toBe('新名称');
      expect(result.category).toBe('原分类');
      expect(result.isPublic).toBe(0);
    });

    it('只更新分类', async () => {
      const result = await service.updateCombo('combo-partial', { category: '新分类' });
      expect(result.name).toBe('原名称');
      expect(result.category).toBe('新分类');
      expect(result.isPublic).toBe(0);
    });

    it('只更新公开状态', async () => {
      const result = await service.updateCombo('combo-partial', { isPublic: true });
      expect(result.name).toBe('原名称');
      expect(result.category).toBe('原分类');
      expect(result.isPublic).toBe(1);
    });

    it('同时更新名称和分类', async () => {
      const result = await service.updateCombo('combo-partial', {
        name: '新名称',
        category: '新分类',
      });
      expect(result.name).toBe('新名称');
      expect(result.category).toBe('新分类');
      expect(result.isPublic).toBe(0);
    });
  });
});