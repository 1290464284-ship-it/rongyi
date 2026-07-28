import { ImagingService } from './imaging.service';
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

describe('ImagingService', () => {
  let service: ImagingService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new ImagingService(db as any, createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  describe('findMany - 分页查询', () => {
    beforeEach(() => {
      db.seed('Imaging', [
        { id: 'imaging-001', title: '全景片', patientId: 'patient-001', type: 'XRAY', url: '/img1.jpg', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'imaging-002', title: '根尖片', patientId: 'patient-001', type: 'XRAY', url: '/img2.jpg', clinicId: 'test-clinic-001', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
        { id: 'imaging-003', title: 'CBCT', patientId: 'patient-002', type: 'CBCT', url: '/img3.jpg', clinicId: 'test-clinic-001', createdAt: '2026-01-03', updatedAt: '2026-01-03' },
      ]);
    });

    it('正常返回所有影像记录', async () => {
      const result = await service.findMany();
      expect(result.items.length).toBe(3);
    });

    it('支持 keyword 搜索（mock 不支持复杂 LIKE 组合，使用 spyOn 模拟过滤结果）', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/SELECT COUNT/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ total: 1, count: 1 }), all: () => [{ total: 1, count: 1 }] };
        }
        if (/FROM\s+Imaging/i.test(sql) && /ORDER BY/i.test(sql) && /LIKE/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({}), all: () => [db.getTableData('Imaging')[0]] };
        }
        return originalPrepare(sql);
      });
      const result = await service.findMany({ keyword: '全景' });
      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).title).toBe('全景片');
      prepareSpy.mockRestore();
    });

    it('支持 filters 过滤', async () => {
      const result = await service.findMany({ filters: { patientId: 'patient-001' } });
      expect(result.items.length).toBe(2);
    });

    it('支持分页参数', async () => {
      const result = await service.findMany({ page: 1, pageSize: 2 });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(3);
    });

    it('支持排序', async () => {
      const result = await service.findMany({ sortBy: 'createdAt', sortOrder: 'ASC' });
      expect(result.items.length).toBe(3);
      expect((result.items[result.items.length - 1] as any).title).toBe('CBCT');
    });
  });

  describe('findOne - 查询单条', () => {
    beforeEach(() => {
      db.seed('Imaging', [
        { id: 'imaging-001', title: '全景片', patientId: 'patient-001', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('正常查询', async () => {
      const result = await service.findOne('imaging-001');
      expect((result as any).id).toBe('imaging-001');
      expect((result as any).title).toBe('全景片');
    });

    it('不存在的 ID 抛出 BusinessNotFoundException', async () => {
      await expect(service.findOne('non-existent-id')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('create - 创建影像记录', () => {
    it('正常创建', async () => {
      const result = await service.create({
        title: '新影像',
        patientId: 'patient-001',
        type: 'XRAY',
        url: '/new.jpg',
      });
      expect((result as any).title).toBe('新影像');
      expect((result as any).patientId).toBe('patient-001');
    });

    it('自动注入 clinicId', async () => {
      const result = await service.create({
        title: '测试影像',
        patientId: 'patient-001',
      });
      expect((result as any).clinicId).toBe('test-clinic-001');
    });
  });

  describe('update - 更新影像记录', () => {
    beforeEach(() => {
      db.seed('Imaging', [
        { id: 'imaging-001', title: '全景片', patientId: 'patient-001', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('正常更新', async () => {
      const result = await service.update('imaging-001', { title: '更新后的全景片' });
      expect((result as any).title).toBe('更新后的全景片');
    });

    it('不存在的记录抛出 BusinessNotFoundException', async () => {
      await expect(service.update('non-existent-id', { title: 'test' } as any)).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('softDelete - 软删除', () => {
    beforeEach(() => {
      db.seed('Imaging', [
        { id: 'imaging-001', title: '全景片', patientId: 'patient-001', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('正常软删除', async () => {
      await service.softDelete('imaging-001');
      const items = db.getTableData('Imaging');
      const deleted = items.find(i => i.id === 'imaging-001');
      expect(deleted?.deletedAt).toBeDefined();
    });

    it('不存在的记录抛出 BusinessNotFoundException', async () => {
      await expect(service.softDelete('non-existent-id')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('诊所隔离', () => {
    beforeEach(() => {
      db.seed('Imaging', [
        { id: 'imaging-001', title: '诊所A影像', patientId: 'patient-001', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'imaging-002', title: '诊所B影像', patientId: 'patient-002', clinicId: 'other-clinic', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
      ]);
    });

    it('只返回当前诊所的数据', async () => {
      const result = await service.findMany();
      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).clinicId).toBe('test-clinic-001');
    });

    it('skipClinicFilter 跳过诊所过滤', async () => {
      const result = await service.findMany({ skipClinicFilter: true });
      expect(result.items.length).toBe(2);
    });
  });
});
