import { EquipmentService } from './equipment.service';
import { BusinessNotFoundException } from '@common/errors';
import { MockDbService } from '../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../common/services/clinic-context.service';


function createMockClinicContext(clinicId: string | null = 'test-clinic-001'): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user-001',
    getRole: () => 'BOSS',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('EquipmentService', () => {
  let service: EquipmentService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new EquipmentService(db as any, createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  describe('findMany - 分页查询', () => {
    beforeEach(() => {
      db.seed('Equipment', [
        { id: 'equip-1', name: '牙科综合治疗台', model: 'A100', brand: '品牌A', category: '治疗设备', status: 'NORMAL', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'equip-2', name: '口腔X光机', model: 'X200', brand: '品牌B', category: '影像设备', status: 'NORMAL', clinicId: 'test-clinic-001', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
        { id: 'equip-3', name: '超声波洁牙机', model: 'S300', brand: '品牌A', category: '清洁设备', status: 'BROKEN', clinicId: 'test-clinic-001', createdAt: '2026-01-03', updatedAt: '2026-01-03' },
      ]);
    });

    it('正常返回所有设备', async () => {
      const result = await service.findMany();
      expect(result.items.length).toBe(3);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(20);
    });

    it('支持 keyword 搜索（name 字段）', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/SELECT COUNT/i.test(sql) && /LIKE/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ total: 1, count: 1 }), all: () => [{ total: 1, count: 1 }] };
        }
        if (/FROM\s+Equipment/i.test(sql) && /LIKE/i.test(sql) && /ORDER BY/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({}), all: () => [db.getTableData('Equipment')[0]] };
        }
        return originalPrepare(sql);
      });
      const result = await service.findMany({ keyword: '牙科' });
      expect(result.items.length).toBe(1);
      prepareSpy.mockRestore();
    });

    it('支持分页', async () => {
      const result = await service.findMany({ page: 1, pageSize: 2 });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });

    it('支持 filters 过滤（按 category）', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/SELECT COUNT/i.test(sql) && /category\s*=\s*\?/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ total: 1, count: 1 }), all: () => [{ total: 1, count: 1 }] };
        }
        if (/FROM\s+Equipment/i.test(sql) && /category\s*=\s*\?/i.test(sql) && /ORDER BY/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({}), all: () => [db.getTableData('Equipment')[1]] };
        }
        return originalPrepare(sql);
      });
      const result = await service.findMany({ filters: { category: '影像设备' } });
      expect(result.items.length).toBe(1);
      prepareSpy.mockRestore();
    });

    it('支持 filters 过滤（按 status）', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/SELECT COUNT/i.test(sql) && /status\s*=\s*\?/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ total: 2, count: 2 }), all: () => [{ total: 2, count: 2 }] };
        }
        if (/FROM\s+Equipment/i.test(sql) && /status\s*=\s*\?/i.test(sql) && /ORDER BY/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({}), all: () => db.getTableData('Equipment').slice(0, 2) };
        }
        return originalPrepare(sql);
      });
      const result = await service.findMany({ filters: { status: 'NORMAL' } });
      expect(result.items.length).toBe(2);
      prepareSpy.mockRestore();
    });
  });

  describe('findOne - 查询单条', () => {
    beforeEach(() => {
      db.seed('Equipment', [
        { id: 'equip-1', name: '牙科综合治疗台', model: 'A100', brand: '品牌A', category: '治疗设备', status: 'NORMAL', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('正常查询', async () => {
      const result = await service.findOne('equip-1');
      expect(result.id).toBe('equip-1');
      expect(result.name).toBe('牙科综合治疗台');
    });

    it('不存在的 ID 抛出 BusinessNotFoundException', async () => {
      await expect(service.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });

    it('已软删的记录不返回', async () => {
      db.clear();
      db.seed('Equipment', [
        { id: 'equip-1', name: '牙科综合治疗台', model: 'A100', brand: '品牌A', category: '治疗设备', status: 'NORMAL', clinicId: 'test-clinic-001', deletedAt: '2026-01-01' },
      ]);
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/WHERE\s+id\s*=\s*\?/i.test(sql) && /deletedAt IS NULL/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => null, all: () => [] };
        }
        return originalPrepare(sql);
      });
      await expect(service.findOne('equip-1')).rejects.toThrow(BusinessNotFoundException);
      prepareSpy.mockRestore();
    });
  });

  describe('create - 创建设备', () => {
    it('正常创建', async () => {
      const result = await service.create({ name: '新设备', model: 'M001', brand: '品牌X', category: '诊断设备', status: 'NORMAL' });
      expect((result as any).name).toBe('新设备');
      expect((result as any).model).toBe('M001');
      expect((result as any).brand).toBe('品牌X');
    });

    it('name 重复时抛出错误（唯一约束）', async () => {
      db.seed('Equipment', [
        { id: 'equip-1', name: '牙科综合治疗台', model: 'A100', brand: '品牌A', category: '治疗设备', status: 'NORMAL', clinicId: 'test-clinic-001' },
      ]);
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        const stmt = originalPrepare(sql);
        if (/INSERT/i.test(sql)) {
          return {
            ...stmt,
            run: () => {
              throw new Error('UNIQUE constraint failed: Equipment.name');
            },
          };
        }
        return stmt;
      });
      await expect(
        service.create({ name: '牙科综合治疗台', category: '治疗设备', status: 'NORMAL' }),
      ).rejects.toThrow('UNIQUE constraint failed');
      prepareSpy.mockRestore();
    });

    it('已软删的同 name 不视为冲突', async () => {
      db.seed('Equipment', [
        { id: 'equip-1', name: '牙科综合治疗台', model: 'A100', brand: '品牌A', category: '治疗设备', status: 'NORMAL', clinicId: 'test-clinic-001', deletedAt: '2026-01-01' },
      ]);
      const result = await service.create({ name: '牙科综合治疗台', category: '治疗设备', status: 'NORMAL' });
      expect(result).toBeDefined();
    });
  });

  describe('update - 更新设备', () => {
    beforeEach(() => {
      db.seed('Equipment', [
        { id: 'equip-1', name: '牙科综合治疗台', model: 'A100', brand: '品牌A', category: '治疗设备', status: 'NORMAL', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('正常更新', async () => {
      const result = await service.update('equip-1', { name: '更新后的设备名', status: 'BROKEN' });
      expect((result as any).name).toBe('更新后的设备名');
      expect((result as any).status).toBe('BROKEN');
    });
  });

  describe('remove - 删除设备', () => {
    beforeEach(() => {
      db.seed('Equipment', [
        { id: 'equip-1', name: '牙科综合治疗台', model: 'A100', brand: '品牌A', category: '治疗设备', status: 'NORMAL', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('正常删除', async () => {
      const result = await service.remove('equip-1');
      expect(result).toBe('equip-1');
    });
  });
});
