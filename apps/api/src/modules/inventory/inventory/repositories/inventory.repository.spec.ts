import { InventoryRepository } from './inventory.repository';

function buildMockDb(overrides: { getReturn?: unknown; allReturn?: unknown[] } = {}) {
  const { getReturn = null, allReturn = [] } = overrides;
  const calls: Array<{ sql: string; method: string; params: unknown[] }> = [];
  return {
    _calls: calls,
    prepare(sql: string) {
      return {
        get: (...params: unknown[]) => { calls.push({ sql, method: 'get', params }); return getReturn; },
        all: (...params: unknown[]) => { calls.push({ sql, method: 'all', params }); return allReturn; },
        run: (...params: unknown[]) => { calls.push({ sql, method: 'run', params }); return { changes: 1, lastInsertRowid: 1 }; },
      };
    },
  };
}

describe('InventoryRepository', () => {
  let repo: InventoryRepository;

  beforeEach(() => {
    repo = new InventoryRepository();
  });

  describe('create', () => {
    it('应插入库存记录', () => {
      const db = buildMockDb();
      repo.create(db, {
        id: 'i-1', code: 'A001', name: '手套', category: '耗材', unit: '盒',
        stock: 100, minStock: 10, price: 500, createdAt: '2026-07-30', updatedAt: '2026-07-30',
      });
      expect(db._calls[0].sql).toContain('INSERT INTO InventoryItem');
      expect(db._calls[0].params).toContain('i-1');
      expect(db._calls[0].params).toContain('A001');
    });
  });

  describe('update', () => {
    it('updates 为空时应直接返回', () => {
      const db = buildMockDb();
      repo.update(db, 'i-1', [], [], '', []);
      expect(db._calls).toHaveLength(0);
    });

    it('应构造 UPDATE 语句', () => {
      const db = buildMockDb();
      repo.update(db, 'i-1', ['stock = ?', 'updatedAt = ?'], [200, '2026-07-30'], ' AND clinicId = ?', ['cl-1']);
      expect(db._calls[0].sql).toContain('UPDATE InventoryItem SET stock = ?, updatedAt = ?');
    });
  });

  describe('findById', () => {
    it('应查询单条库存记录', () => {
      const db = buildMockDb({ getReturn: { id: 'i-1', name: '手套', stock: 100 } });
      const result = repo.findById(db, 'i-1', ' AND clinicId = ?', ['cl-1']);
      expect(db._calls[0].sql).toContain('FROM InventoryItem');
      expect(db._calls[0].sql).toContain('deletedAt IS NULL');
      expect(result).toEqual({ id: 'i-1', name: '手套', stock: 100 });
    });

    it('未找到时应返回 null（调用方负责类型断言）', () => {
      const db = buildMockDb({ getReturn: null });
      const result = repo.findById(db, 'i-999', '', []);
      expect(result).toBeNull();
    });
  });

  describe('findMany', () => {
    it('应按条件分页查询库存列表', () => {
      const db = buildMockDb({ getReturn: { total: 3 }, allReturn: [{ id: 'i-1' }, { id: 'i-2' }] });
      const result = repo.findMany(db, {
        clinicClause: 'clinicId = ?',
        clinicParams: ['cl-1'],
        page: 1,
        pageSize: 20,
      });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(3);
    });

    it('应支持按关键字搜索', () => {
      const db = buildMockDb({ getReturn: { total: 1 }, allReturn: [{ id: 'i-1' }] });
      repo.findMany(db, {
        clinicClause: '',
        clinicParams: [],
        keyword: '手套',
        page: 1,
        pageSize: 10,
      });
      const countCall = db._calls.find(c => c.sql.includes('COUNT'));
      expect(countCall?.sql).toContain('name LIKE ?');
      expect(countCall?.sql).toContain('code LIKE ?');
    });

    it('应支持按分类过滤', () => {
      const db = buildMockDb({ getReturn: { total: 0 }, allReturn: [] });
      repo.findMany(db, {
        clinicClause: '',
        clinicParams: [],
        category: '耗材',
        page: 1,
        pageSize: 10,
      });
      const countCall = db._calls.find(c => c.sql.includes('COUNT'));
      expect(countCall?.sql).toContain('category = ?');
      expect(countCall?.params).toContain('耗材');
    });

    it('应同时支持关键字 + 分类 + 诊所条件', () => {
      const db = buildMockDb({ getReturn: { total: 0 }, allReturn: [] });
      repo.findMany(db, {
        clinicClause: 'AND clinicId = ?',
        clinicParams: ['cl-1'],
        keyword: '手套',
        category: '耗材',
        page: 2,
        pageSize: 10,
      });
      const countCall = db._calls.find(c => c.sql.includes('COUNT'));
      expect(countCall?.sql).toContain('clinicId = ?');
      expect(countCall?.sql).toContain('category = ?');
      expect(countCall?.sql).toContain('name LIKE ?');
    });
  });

  describe('delete', () => {
    it('应构造 DELETE 语句', () => {
      const db = buildMockDb();
      repo.delete(db, 'i-1', ' AND clinicId = ?', ['cl-1']);
      expect(db._calls[0].sql).toContain('DELETE FROM InventoryItem WHERE id = ? AND clinicId = ?');
      expect(db._calls[0].params).toEqual(['i-1', 'cl-1']);
    });
  });

  describe('findLowStockItems', () => {
    it('应查询低于最低库存的物品', () => {
      const db = buildMockDb({ allReturn: [{ id: 'i-1', stock: 5, minStock: 10 }] });
      const result = repo.findLowStockItems(db, ' AND clinicId = ?', ['cl-1']);
      expect(db._calls[0].sql).toContain('stock <= minStock');
      expect(result).toHaveLength(1);
    });
  });

  describe('findTransactions', () => {
    it('有 itemId 时应按 itemId 过滤', () => {
      const db = buildMockDb({ allReturn: [{ id: 't-1', itemId: 'i-1' }] });
      const result = repo.findTransactions(db, {
        clinicClause: '',
        clinicParams: [],
        itemId: 'i-1',
        limit: 20,
        offset: 0,
      });
      expect(db._calls[0].sql).toContain('itemId = ?');
      expect(result).toHaveLength(1);
    });

    it('无 itemId 时应查询全部交易', () => {
      const db = buildMockDb({ allReturn: [{ id: 't-1' }, { id: 't-2' }] });
      const result = repo.findTransactions(db, {
        clinicClause: ' AND clinicId = ?',
        clinicParams: ['cl-1'],
        limit: 50,
        offset: 0,
      });
      expect(db._calls[0].sql).toContain('WHERE 1=1');
      expect(result).toHaveLength(2);
    });
  });

  describe('findItemForStockAction', () => {
    it('应查询库存操作所需的物品信息', () => {
      const db = buildMockDb({ getReturn: { id: 'i-1', code: 'A001', name: '手套', stock: 50 } });
      const result = repo.findItemForStockAction(db, 'i-1', '', []);
      expect(db._calls[0].sql).toContain('SELECT id, code, name, stock');
      expect(result?.stock).toBe(50);
    });
  });

  describe('incrementStock', () => {
    it('应增加库存', () => {
      const db = buildMockDb();
      repo.incrementStock(db, 'i-1', 10, '2026-07-30', '', []);
      expect(db._calls[0].sql).toContain('stock = stock + ?');
    });
  });

  describe('decrementStock', () => {
    it('应减少库存并检查不低于零', () => {
      const db = buildMockDb();
      repo.decrementStock(db, 'i-1', 5, '2026-07-30', '', []);
      expect(db._calls[0].sql).toContain('stock = stock - ?');
      expect(db._calls[0].sql).toContain('stock >= ?');
    });
  });

  describe('setStockWithOptimisticLock', () => {
    it('应使用乐观锁设置库存', () => {
      const db = buildMockDb();
      repo.setStockWithOptimisticLock(db, 'i-1', 100, '2026-07-30', 90, '', []);
      expect(db._calls[0].sql).toContain('stock = ?');
      expect(db._calls[0].sql).toContain('stock = ?');
    });
  });

  describe('getStock', () => {
    it('应查询当前库存', () => {
      const db = buildMockDb({ getReturn: { stock: 42 } });
      const result = repo.getStock(db, 'i-1', '', []);
      expect(result?.stock).toBe(42);
    });
  });

  describe('createTransaction', () => {
    it('应插入库存交易记录', () => {
      const db = buildMockDb();
      repo.createTransaction(db, {
        id: 't-1', itemId: 'i-1', type: 'IN', quantity: 10, unitPrice: 500,
        totalAmount: 5000, createdAt: '2026-07-30',
      });
      expect(db._calls[0].sql).toContain('INSERT INTO InventoryTransaction');
      expect(db._calls[0].params).toContain('t-1');
    });
  });
});
