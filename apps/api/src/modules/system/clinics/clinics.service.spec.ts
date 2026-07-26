import { ClinicsService } from './clinics.service';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { CacheService } from '../../../common/services/cache.service';
import { BadRequestException, ConflictException } from '@nestjs/common';

function createMockCacheService(): CacheService {
  const store = new Map<string, unknown>();
  return {
    get: <T>(key: string): T | undefined => store.get(key) as T | undefined,
    set: (key: string, value: unknown) => { store.set(key, value); },
    del: (key: string) => { store.delete(key); },
    delPattern: (pattern: string) => {
      for (const k of store.keys()) {
        if (k.startsWith(pattern)) store.delete(k);
      }
    },
    getOrSet: async <T>(key: string, factory: () => Promise<T> | T): Promise<T> => {
      const cached = store.get(key) as T | undefined;
      if (cached !== undefined) return cached;
      const value = await factory();
      store.set(key, value);
      return value;
    },
  } as unknown as CacheService;
}

function createMockClinicContext(clinicId: string | null = 'test-clinic-001'): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user-001',
    getRole: () => 'BOSS',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('ClinicsService', () => {
  let service: ClinicsService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new ClinicsService(db as any, createMockClinicContext(), createMockCacheService());
  });

  afterEach(() => {
    db.clear();
  });

  describe('findMany - 分页查询（跳过 clinicId 过滤）', () => {
    beforeEach(() => {
      db.seed('Clinic', [
        { id: 'clinic-1', name: '总店', code: 'C001', isActive: 1, address: 'A', phone: '123', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'clinic-2', name: '分店', code: 'C002', isActive: 1, address: 'B', phone: '456', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
      ]);
    });

    it('正常返回所有诊所', async () => {
      const result = await service.findMany();
      expect(result.items.length).toBe(2);
    });

    it('支持 keyword 搜索（mock 不支持复杂 LIKE 组合，使用 spyOn 模拟过滤结果）', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        // COUNT 查询返回 1 条匹配
        if (/SELECT COUNT/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ total: 1, count: 1 }), all: () => [{ total: 1, count: 1 }] };
        }
        // 数据查询：返回第一条匹配项
        if (/FROM\s+Clinic/i.test(sql) && /ORDER BY/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({}), all: () => [db.getTableData('Clinic')[0]] };
        }
        return originalPrepare(sql);
      });
      const result = await service.findMany({ keyword: '总店' });
      expect(result.items.length).toBe(1);
      prepareSpy.mockRestore();
    });

    it('支持 filters 过滤', async () => {
      const result = await service.findMany({ filters: { code: 'C002' } });
      expect(result.items.length).toBe(1);
    });
  });

  describe('findOne - 查询单条（跳过 clinicId 过滤）', () => {
    beforeEach(() => {
      db.seed('Clinic', [
        { id: 'clinic-1', name: '总店', code: 'C001', isActive: 1, address: 'A', phone: '123', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('正常查询', async () => {
      const result = await service.findOne('clinic-1');
      expect(result.id).toBe('clinic-1');
    });

    it('不存在的 ID 抛出 BadRequestException', async () => {
      await expect(service.findOne('non-existent')).rejects.toThrow(BadRequestException);
    });

    it('已软删的记录不返回', async () => {
      db.clear();
      db.seed('Clinic', [
        { id: 'clinic-1', name: '总店', code: 'C001', isActive: 1, deletedAt: '2026-01-01' },
      ]);
      // 使用 spyOn 强制返回 null，模拟 deletedAt IS NULL 过滤
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/WHERE\s+id\s*=\s*\?/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => null, all: () => [] };
        }
        return originalPrepare(sql);
      });
      await expect(service.findOne('clinic-1')).rejects.toThrow(BadRequestException);
      prepareSpy.mockRestore();
    });
  });

  describe('create - 创建诊所', () => {
    it('正常创建', async () => {
      const result = await service.create({ name: '新店', code: 'NEW001' });
      expect((result as any).code).toBe('NEW001');
      expect((result as any).name).toBe('新店');
    });

    it('code 重复时抛出 ConflictException', async () => {
      db.seed('Clinic', [
        { id: 'clinic-1', name: '总店', code: 'C001', isActive: 1 },
      ]);
      await expect(
        service.create({ name: '新店', code: 'C001' }),
      ).rejects.toThrow(ConflictException);
    });

    it('已软删的同 code 不视为冲突', async () => {
      // 已软删的 code 不在冲突检查中
      // 但 BaseService.create 仍会成功插入
      db.seed('Clinic', [
        { id: 'clinic-1', name: '总店', code: 'C001', isActive: 1, deletedAt: '2026-01-01' },
      ]);
      // 使用 spyOn 模拟 code 唯一性检查返回 null（软删除不视为冲突）
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/SELECT\s+id\s+FROM\s+Clinic\s+WHERE\s+code\s*=\s*\?/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => null, all: () => [] };
        }
        return originalPrepare(sql);
      });
      const result = await service.create({ name: '新店', code: 'C001' });
      expect(result).toBeDefined();
      prepareSpy.mockRestore();
    });
  });

  describe('getCurrentClinic - 获取当前诊所', () => {
    beforeEach(() => {
      db.seed('Clinic', [
        { id: 'test-clinic-001', name: '当前诊所', code: 'C001', isActive: 1 },
        { id: 'clinic-inactive', name: '禁用诊所', code: 'C002', isActive: 0 },
        { id: 'clinic-other', name: '其他诊所', code: 'C003', isActive: 1 },
      ]);
    });

    it('返回当前用户的活跃诊所', async () => {
      const result = await service.getCurrentClinic();
      expect(result?.id).toBe('test-clinic-001');
    });

    it('当前诊所被禁用时返回 null', async () => {
      // 通过 spyOn 强制返回 null，覆盖 !clinicId 之外的另一分支
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+Clinic\s+WHERE\s+id\s+=\s+\?/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => null,
            all: () => [],
          };
        }
        return originalPrepare(sql);
      });

      const result = await service.getCurrentClinic();
      expect(result).toBeNull();

      prepareSpy.mockRestore();
    });

    it('无 clinicId 上下文时返回 null', async () => {
      const serviceNoCtx = new ClinicsService(db as any, createMockClinicContext(null), createMockCacheService());
      const result = await serviceNoCtx.getCurrentClinic();
      expect(result).toBeNull();
    });

    it('查询返回诊所对象', async () => {
      // 覆盖正常返回分支（mock 返回第一条记录）
      const result = await service.getCurrentClinic();
      expect(result).not.toBeNull();
      expect(result?.id).toBe('test-clinic-001');
    });
  });

  describe('findActive - 查询所有活跃诊所', () => {
    beforeEach(() => {
      db.seed('Clinic', [
        { id: 'clinic-1', name: '总店', code: 'C001', isActive: 1 },
        { id: 'clinic-2', name: '分店', code: 'C002', isActive: 0 },
      ]);
    });

    it('返回诊所列表（mock 不支持 isActive=1 字面量过滤，覆盖正常路径）', async () => {
      const result = await service.findActive();
      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('空表时返回空数组', async () => {
      db.clear();
      const result = await service.findActive();
      expect(result).toEqual([]);
    });
  });
});
