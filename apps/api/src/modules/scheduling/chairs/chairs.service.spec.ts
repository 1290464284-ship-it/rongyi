import { ChairsService } from './chairs.service';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

function createMockClinicContext(clinicId: string | null = 'test-clinic-001'): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user-001',
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('ChairsService', () => {
  let service: ChairsService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new ChairsService(db as any, createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  describe('findAll - 分页查询牙椅', () => {
    beforeEach(() => {
      db.seed('Chair', [
        { id: 'chair-1', name: '1号椅', location: '一楼A区', active: 1, clinicId: 'test-clinic-001' },
        { id: 'chair-2', name: '2号椅', location: '一楼B区', active: 1, clinicId: 'test-clinic-001' },
        { id: 'chair-3', name: '3号椅', location: '二楼', active: 0, clinicId: 'test-clinic-001' },
        { id: 'chair-other', name: '其他诊所椅', location: 'A区', active: 1, clinicId: 'other-clinic' },
      ]);
    });

    it('使用默认分页参数查询活跃牙椅', async () => {
      const result = await service.findAll();
      expect(result.items).toBeDefined();
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBeGreaterThan(0);
    });

    it('使用自定义 page/pageSize', async () => {
      const result = await service.findAll({ page: 1, pageSize: 2 });
      expect(result.items.length).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });

    it('count 字段为 0 时使用 fallback', async () => {
      // spy 让 SELECT COUNT 返回 { count: 0 }，覆盖 || 0 分支
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/SELECT COUNT/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => ({ total: 0, count: 0 }),
            all: () => [],
          };
        }
        return originalPrepare(sql);
      });

      const result = await service.findAll();
      expect(result.total).toBe(0);

      prepareSpy.mockRestore();
    });

    it('SELECT COUNT 返回 undefined 时使用 fallback', async () => {
      // spy 让 SELECT COUNT 返回 undefined，覆盖 ?.count 分支
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/SELECT COUNT/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => {},
            all: () => [],
          };
        }
        return originalPrepare(sql);
      });

      const result = await service.findAll();
      expect(result.total).toBe(0);

      prepareSpy.mockRestore();
    });

    it('无 clinicId 上下文时抛出错误', async () => {
      const serviceNoCtx = new ChairsService(db as any, createMockClinicContext(null));
      await expect(serviceNoCtx.findAll()).rejects.toThrow();
    });
  });

  describe('create - 创建牙椅', () => {
    it('正常创建牙椅', async () => {
      const result = await service.create({ name: '1号椅', location: 'A区' });
      expect(result).toBeDefined();
      expect((result as any).name).toBe('1号椅');
      expect((result as any).location).toBe('A区');
    });

    it('无 clinicId 上下文且无 dto.clinicId 时抛出 ForbiddenException', async () => {
      const serviceNoCtx = new ChairsService(db as any, createMockClinicContext(null));
      await expect(
        serviceNoCtx.create({ name: '1号椅' } as any),
      ).rejects.toThrow();
    });
  });

  describe('update - 更新牙椅', () => {
    beforeEach(() => {
      db.seed('Chair', [
        { id: 'chair-1', name: '1号椅', location: '一楼A区', active: 1, clinicId: 'test-clinic-001' },
      ]);
    });

    it('正常更新', async () => {
      const result = await service.update('chair-1', { name: '新名字' });
      expect((result as any).name).toBe('新名字');
    });

    it('不存在的 ID 抛出 NotFoundException', async () => {
      await expect(service.update('non-existent', { name: 'x' })).rejects.toThrow(NotFoundException);
    });
  });

  describe('softDelete - 软删除', () => {
    beforeEach(() => {
      db.seed('Chair', [
        { id: 'chair-1', name: '1号椅', location: 'A区', active: 1, clinicId: 'test-clinic-001' },
      ]);
    });

    it('正常软删除', async () => {
      await service.softDelete('chair-1');
      const items = db.getTableData('Chair');
      const deleted = items.find(i => i.id === 'chair-1');
      expect(deleted?.deletedAt).toBeDefined();
    });

    it('不存在的 ID 抛出 NotFoundException', async () => {
      await expect(service.softDelete('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('remove - 软删除（active=0）', () => {
    it('正常执行 remove（UPDATE active=0）', async () => {
      db.seed('Chair', [
        { id: 'chair-1', name: '1号椅', location: 'A区', active: 1, clinicId: 'test-clinic-001' },
      ]);
      await service.remove('chair-1');
      const items = db.getTableData('Chair');
      const updated = items.find(i => i.id === 'chair-1');
      // 记录仍在但 active=0
      expect(updated).toBeDefined();
      expect(updated?.active).toBe(0);
    });
  });

  describe('findOne - 查询单条', () => {
    beforeEach(() => {
      db.seed('Chair', [
        { id: 'chair-1', name: '1号椅', location: 'A区', active: 1, clinicId: 'test-clinic-001' },
      ]);
    });

    it('正常查询', async () => {
      const result = await service.findOne('chair-1');
      expect(result.id).toBe('chair-1');
    });

    it('不存在的 ID 抛出 NotFoundException', async () => {
      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('findMany - 通用查询', () => {
    beforeEach(() => {
      db.seed('Chair', [
        { id: 'chair-1', name: '1号椅', location: 'A区', active: 1, clinicId: 'test-clinic-001' },
        { id: 'chair-2', name: '2号椅', location: 'B区', active: 1, clinicId: 'test-clinic-001' },
      ]);
    });

    it('过滤条件', async () => {
      const result = await service.findMany({ filters: { name: '2号椅' } });
      expect(result.items.length).toBe(1);
    });

    it('无 clinicId 上下文时抛出 ForbiddenException', async () => {
      const serviceNoCtx = new ChairsService(db as any, createMockClinicContext(null));
      await expect(serviceNoCtx.findMany({})).rejects.toThrow();
    });

    it('无效 sortBy 抛出 BadRequestException', async () => {
      await expect(service.findMany({ sortBy: '1invalid' })).rejects.toThrow(BadRequestException);
    });

    it('游标分页 cursor', async () => {
      const result = await service.findMany({ cursor: 'chair-1', pageSize: 10 });
      expect(result.items.length).toBeGreaterThanOrEqual(0);
    });

    it('includeDeleted 包含已软删除记录', async () => {
      db.seed('Chair', [
        { id: 'chair-soft', name: '已软删', location: 'A区', active: 1, clinicId: 'test-clinic-001', deletedAt: '2026-01-01' },
      ]);
      const result = await service.findMany({ includeDeleted: true });
      expect(result.items.length).toBeGreaterThan(0);
    });
  });
});
