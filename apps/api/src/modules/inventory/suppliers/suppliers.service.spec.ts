import { SuppliersService } from './suppliers.service';
import { BusinessNotFoundException } from '@common/errors';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';


function createMockClinicContext(clinicId: string | null = 'test-clinic-001'): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user-001',
    getRole: () => 'BOSS',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('SuppliersService', () => {
  let service: SuppliersService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new SuppliersService(db as any, createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  describe('findMany - 分页查询', () => {
    beforeEach(() => {
      db.seed('Supplier', [
        { id: 'supplier-1', name: '供应商A', code: 'S001', clinicId: 'test-clinic-001', contactPerson: '张三', phone: '13800138001', address: '地址A', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'supplier-2', name: '供应商B', code: 'S002', clinicId: 'test-clinic-001', contactPerson: '李四', phone: '13800138002', address: '地址B', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
        { id: 'supplier-3', name: '供应商C', code: 'S003', clinicId: 'test-clinic-001', contactPerson: '王五', phone: '13800138003', address: '地址C', createdAt: '2026-01-03', updatedAt: '2026-01-03' },
      ]);
    });

    it('正常返回所有供应商', async () => {
      const result = await service.findMany();
      expect(result.items.length).toBe(3);
      expect(result.total).toBe(3);
    });

    it('支持分页', async () => {
      const result = await service.findMany({ page: 1, pageSize: 2 });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });

    it('支持 keyword 搜索（name 字段）', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/SELECT COUNT/i.test(sql) && /LIKE/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ total: 1, count: 1 }), all: () => [{ total: 1, count: 1 }] };
        }
        if (/FROM\s+Supplier/i.test(sql) && /ORDER BY/i.test(sql) && /LIKE/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({}), all: () => [db.getTableData('Supplier')[0]] };
        }
        return originalPrepare(sql);
      });
      const result = await service.findMany({ keyword: '供应商A' });
      expect(result.items.length).toBe(1);
      prepareSpy.mockRestore();
    });

    it('支持 filters 过滤', async () => {
      const result = await service.findMany({ filters: { code: 'S002' } });
      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).code).toBe('S002');
    });
  });

  describe('findOne - 查询单条', () => {
    beforeEach(() => {
      db.seed('Supplier', [
        { id: 'supplier-1', name: '供应商A', code: 'S001', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('正常查询', async () => {
      const result = await service.findOne('supplier-1');
      expect(result.id).toBe('supplier-1');
      expect(result.name).toBe('供应商A');
    });

    it('不存在的 ID 抛出 BusinessNotFoundException', async () => {
      await expect(service.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });

    it('已软删的记录不返回', async () => {
      db.clear();
      db.seed('Supplier', [
        { id: 'supplier-1', name: '供应商A', code: 'S001', clinicId: 'test-clinic-001', deletedAt: '2026-01-01' },
      ]);
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/WHERE\s+id\s*=\s*\?/i.test(sql) && /deletedAt\s+IS\s+NULL/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => null, all: () => [] };
        }
        return originalPrepare(sql);
      });
      await expect(service.findOne('supplier-1')).rejects.toThrow(BusinessNotFoundException);
      prepareSpy.mockRestore();
    });
  });

  describe('create - 创建供应商', () => {
    it('正常创建', async () => {
      const result = await service.create({ name: '新供应商', code: 'NEW001' });
      expect((result as any).code).toBe('NEW001');
      expect(result.name).toBe('新供应商');
    });

    it('code 唯一约束冲突时创建失败', async () => {
      db.seed('Supplier', [
        { id: 'supplier-1', name: '供应商A', code: 'S001', clinicId: 'test-clinic-001' },
      ]);
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const originalStmt = originalPrepare(sql);
        if (/INSERT\s+INTO\s+Supplier/i.test(sql)) {
          return {
            ...originalStmt,
            run: () => {
              throw new Error('UNIQUE constraint failed: Supplier.code');
            },
          };
        }
        return originalStmt;
      });
      await expect(
        service.create({ name: '新供应商', code: 'S001' } as any),
      ).rejects.toThrow('UNIQUE constraint failed');
      prepareSpy.mockRestore();
    });
  });

  describe('update - 更新供应商', () => {
    beforeEach(() => {
      db.seed('Supplier', [
        { id: 'supplier-1', name: '供应商A', code: 'S001', clinicId: 'test-clinic-001', contactPerson: '张三', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('正常更新', async () => {
      const result = await service.update('supplier-1', { name: '供应商A-更新', contactPerson: '张三三' });
      expect(result.name).toBe('供应商A-更新');
      expect((result as any).contactPerson).toBe('张三三');
    });

    it('不存在的记录抛出 BusinessNotFoundException', async () => {
      await expect(
        service.update('non-existent', { name: '测试' } as any),
      ).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('softDelete - 软删除', () => {
    beforeEach(() => {
      db.seed('Supplier', [
        { id: 'supplier-1', name: '供应商A', code: 'S001', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('软删除成功', async () => {
      await service.softDelete('supplier-1');
      const supplier = db.getTableData('Supplier').find(s => s.id === 'supplier-1');
      expect(supplier?.deletedAt).toBeDefined();
    });

    it('软删除后 findOne 找不到', async () => {
      await service.softDelete('supplier-1');
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/WHERE\s+id\s*=\s*\?/i.test(sql) && /deletedAt\s+IS\s+NULL/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => null, all: () => [] };
        }
        return originalPrepare(sql);
      });
      await expect(service.findOne('supplier-1')).rejects.toThrow(BusinessNotFoundException);
      prepareSpy.mockRestore();
    });

    it('唯一字段 code 添加后缀避免冲突', async () => {
      await service.softDelete('supplier-1');
      const supplier = db.getTableData('Supplier').find(s => s.id === 'supplier-1');
      expect((supplier as any)?.code).not.toBe('S001');
      expect((supplier as any)?.code).toContain('S001');
      expect((supplier as any)?.code).toContain('_deleted_');
    });

    it('已软删的记录再次删除抛出 BusinessNotFoundException', async () => {
      await service.softDelete('supplier-1');
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+Supplier\s+WHERE\s+id\s*=\s*\?/i.test(sql) && /deletedAt\s+IS\s+NULL/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => null, all: () => [] };
        }
        return originalPrepare(sql);
      });
      await expect(service.softDelete('supplier-1')).rejects.toThrow(BusinessNotFoundException);
      prepareSpy.mockRestore();
    });

    it('不存在的记录抛出 BusinessNotFoundException', async () => {
      await expect(service.softDelete('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });
});
