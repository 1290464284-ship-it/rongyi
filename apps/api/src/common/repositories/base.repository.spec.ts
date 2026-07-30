import { BaseRepository, SqlExecutor } from './base.repository';

function buildMockDb(): SqlExecutor & { _calls: Array<{ sql: string; method: string; params: unknown[] }> } {
  const calls: Array<{ sql: string; method: string; params: unknown[] }> = [];
  return {
    _calls: calls,
    prepare(sql: string) {
      return {
        get: (...params: unknown[]) => {
          calls.push({ sql, method: 'get', params });
          return null;
        },
        all: (...params: unknown[]) => {
          calls.push({ sql, method: 'all', params });
          return [];
        },
        run: (...params: unknown[]) => {
          calls.push({ sql, method: 'run', params });
          return { changes: 1, lastInsertRowid: 1 };
        },
      };
    },
  };
}

describe('BaseRepository', () => {
  let repo: BaseRepository;
  let db: ReturnType<typeof buildMockDb>;

  beforeEach(() => {
    repo = new BaseRepository();
    db = buildMockDb();
  });

  // ==================== insert ====================
  describe('insert', () => {
    it('应构造 INSERT 语句并执行', () => {
      repo.insert(db, 'patients', { id: '1', name: '张三', phone: '138' });
      expect(db._calls[0].sql).toBe('INSERT INTO patients (id, name, phone) VALUES (?, ?, ?)');
      expect(db._calls[0].params).toEqual(['1', '张三', '138']);
    });
  });

  // ==================== findById ====================
  describe('findById', () => {
    it('应构造 SELECT 语句按 id 查询', () => {
      repo.findById(db, 'patients', '*', 'p-1');
      expect(db._calls[0].sql).toBe('SELECT * FROM patients WHERE id = ?');
      expect(db._calls[0].params).toEqual(['p-1']);
    });

    it('应支持额外条件', () => {
      repo.findById(db, 'patients', 'id, name', 'p-1', ['clinicId = ?'], ['cl-1']);
      expect(db._calls[0].sql).toBe('SELECT id, name FROM patients WHERE id = ? AND clinicId = ?');
      expect(db._calls[0].params).toEqual(['p-1', 'cl-1']);
    });
  });

  // ==================== update ====================
  describe('update', () => {
    it('应构造 UPDATE 语句', () => {
      repo.update(db, 'patients', ['name = ?', 'updatedAt = ?'], ['李四', '2026-01-01'], 'p-1', ' AND clinicId = ?', ['cl-1']);
      expect(db._calls[0].sql).toBe('UPDATE patients SET name = ?, updatedAt = ? WHERE id = ? AND clinicId = ?');
      expect(db._calls[0].params).toEqual(['李四', '2026-01-01', 'p-1', 'cl-1']);
    });
  });

  // ==================== delete ====================
  describe('delete', () => {
    it('应构造 DELETE 语句', () => {
      repo.delete(db, 'patients', 'p-1', ' AND clinicId = ?', ['cl-1']);
      expect(db._calls[0].sql).toBe('DELETE FROM patients WHERE id = ? AND clinicId = ?');
      expect(db._calls[0].params).toEqual(['p-1', 'cl-1']);
    });

    it('无诊所条件时应仅按 id 删除', () => {
      repo.delete(db, 'patients', 'p-1', '', []);
      expect(db._calls[0].sql).toBe('DELETE FROM patients WHERE id = ?');
      expect(db._calls[0].params).toEqual(['p-1']);
    });
  });

  // ==================== buildPaginatedQuery ====================
  describe('buildPaginatedQuery', () => {
    it('无游标时应使用 OFFSET 分页', () => {
      const result = repo.buildPaginatedQuery('patients', '*', ' WHERE deletedAt IS NULL', [], 'createdAt', 'DESC', undefined, 20, 1);
      expect(result.countSql).toBe('SELECT COUNT(*) as total FROM patients WHERE deletedAt IS NULL');
      expect(result.dataSql).toContain('ORDER BY createdAt DESC, id DESC LIMIT ? OFFSET ?');
      expect(result.dataParams).toEqual([20, 0]);
    });

    it('有游标时应使用游标分页', () => {
      const result = repo.buildPaginatedQuery('patients', '*', ' WHERE deletedAt IS NULL', [], 'createdAt', 'DESC', 'cursor-123', 20, 1);
      expect(result.dataSql).toContain('id < ?');
      expect(result.dataSql).toContain('LIMIT ?');
      expect(result.dataParams).toContain('cursor-123');
      expect(result.dataParams).toContain(20);
    });

    it('ASC 排序时游标应使用 > 操作符', () => {
      const result = repo.buildPaginatedQuery('patients', '*', '', [], 'name', 'ASC', 'cursor-1', 10, 2);
      expect(result.dataSql).toContain('id > ?');
    });

    it('无 WHERE 子句时游标分页应添加 WHERE 关键字', () => {
      const result = repo.buildPaginatedQuery('patients', '*', '', [], 'createdAt', 'DESC', 'cursor-1', 10, 1);
      expect(result.dataSql).toContain('WHERE id <');
    });
  });

  // ==================== executePaginatedQuery ====================
  describe('executePaginatedQuery', () => {
    it('应返回 items 和 total', () => {
      const mockDbWithResults: SqlExecutor = {
        prepare(sql: string) {
          if (sql.includes('COUNT')) {
            return { get: () => ({ total: 42 }), all: () => [], run: () => ({ changes: 0, lastInsertRowid: 0 }) };
          }
          return {
            get: () => null,
            all: () => [{ id: '1' }, { id: '2' }],
            run: () => ({ changes: 0, lastInsertRowid: 0 }),
          };
        },
      };
      const query = { countSql: 'SELECT COUNT(*)', dataSql: 'SELECT *', countParams: [], dataParams: [] };
      const result = repo.executePaginatedQuery(mockDbWithResults, query);
      expect(result.total).toBe(42);
      expect(result.items).toHaveLength(2);
    });

    it('countRow 为 null 时 total 应为 0', () => {
      const mockDbNull: SqlExecutor = {
        prepare: () => ({ get: () => null, all: () => [], run: () => ({ changes: 0, lastInsertRowid: 0 }) }),
      };
      const result = repo.executePaginatedQuery(mockDbNull, { countSql: '', dataSql: '', countParams: [], dataParams: [] });
      expect(result.total).toBe(0);
    });
  });

  // ==================== batchFindByIds ====================
  describe('batchFindByIds', () => {
    it('空 ids 应直接返回空数组', () => {
      const result = repo.batchFindByIds(db, [], 'clinics', 'id, name');
      expect(result).toEqual([]);
      expect(db._calls).toHaveLength(0);
    });

    it('应构造 IN 查询', () => {
      repo.batchFindByIds(db, ['c-1', 'c-2', 'c-3'], 'clinics', 'id, name');
      expect(db._calls[0].sql).toBe('SELECT id, name FROM clinics WHERE id IN (?,?,?)');
      expect(db._calls[0].params).toEqual(['c-1', 'c-2', 'c-3']);
    });
  });

  // ==================== queryOne ====================
  describe('queryOne', () => {
    it('应执行参数化查询并返回单条', () => {
      repo.queryOne(db, 'SELECT * FROM patients WHERE id = ?', ['p-1']);
      expect(db._calls[0].sql).toBe('SELECT * FROM patients WHERE id = ?');
      expect(db._calls[0].params).toEqual(['p-1']);
    });

    it('无参数时应使用默认空数组', () => {
      repo.queryOne(db, 'SELECT COUNT(*) as count FROM patients');
      expect(db._calls[0].params).toEqual([]);
    });
  });

  // ==================== queryAll ====================
  describe('queryAll', () => {
    it('应执行参数化查询并返回多条', () => {
      repo.queryAll(db, 'SELECT * FROM patients WHERE clinicId = ?', ['cl-1']);
      expect(db._calls[0].sql).toBe('SELECT * FROM patients WHERE clinicId = ?');
      expect(db._calls[0].params).toEqual(['cl-1']);
    });
  });

  // ==================== execute ====================
  describe('execute', () => {
    it('应执行写操作并返回结果', () => {
      const result = repo.execute(db, 'DELETE FROM patients WHERE id = ?', ['p-1']);
      expect(db._calls[0].sql).toBe('DELETE FROM patients WHERE id = ?');
      expect(result).toEqual({ changes: 1, lastInsertRowid: 1 });
    });
  });

  // ==================== buildPaginatedQueryWithConditions ====================
  describe('buildPaginatedQueryWithConditions', () => {
    it('有条件时应拼接 WHERE 子句', () => {
      const result = repo.buildPaginatedQueryWithConditions(
        'patients', '*', ['deletedAt IS NULL', 'clinicId = ?'], ['cl-1'], 'createdAt', 'DESC', undefined, 20, 1,
      );
      expect(result.countSql).toContain('WHERE deletedAt IS NULL AND clinicId = ?');
      expect(result.countParams).toEqual(['cl-1']);
    });

    it('无条件时 WHERE 子句应为空', () => {
      const result = repo.buildPaginatedQueryWithConditions(
        'patients', '*', [], [], 'createdAt', 'DESC', undefined, 10, 1,
      );
      expect(result.countSql).not.toContain('WHERE');
    });
  });

  // ==================== isValidColumnName ====================
  describe('isValidColumnName', () => {
    it('合法列名应返回 true', () => {
      expect(repo.isValidColumnName('name')).toBe(true);
      expect(repo.isValidColumnName('created_at')).toBe(true);
    });

    it('非法列名应返回 false', () => {
      expect(repo.isValidColumnName('')).toBe(false);
      expect(repo.isValidColumnName('123abc')).toBe(false);
    });
  });
});
