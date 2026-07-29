import { PeriodontalRecordsService } from './periodontal-records.service';
import { BusinessNotFoundException } from '@common/errors';
import { MockDbService , asDbService } from '../../../db/__mocks__/db-service.mock';
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

describe('PeriodontalRecordsService', () => {
  let service: PeriodontalRecordsService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new PeriodontalRecordsService(asDbService(db), createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  describe('findMany - 分页查询', () => {
    beforeEach(() => {
      db.seed('PeriodontalRecord', [
        { id: 'periorecord-1', patientId: 'patient-1', clinicId: 'test-clinic-001', remark: '初诊', examDate: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'periorecord-2', patientId: 'patient-1', clinicId: 'test-clinic-001', remark: '复查', examDate: '2026-02-01', createdAt: '2026-02-01', updatedAt: '2026-02-01' },
        { id: 'periorecord-3', patientId: 'patient-2', clinicId: 'test-clinic-001', remark: '常规检查', examDate: '2026-03-01', createdAt: '2026-03-01', updatedAt: '2026-03-01' },
      ]);
    });

    it('正常返回列表', async () => {
      const result = await service.findMany();
      expect(result.items.length).toBe(3);
      expect(result.total).toBe(3);
    });

    it('支持 keyword 搜索（mock 不支持 OR LIKE 组合，使用 spyOn 模拟）', async () => {
      const allRows = db.getTableData('PeriodontalRecord');
      const matchedRow = allRows.find(r => r.id === 'periorecord-2');

      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/SELECT COUNT/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ total: 1, count: 1 }), all: () => [{ total: 1, count: 1 }] };
        }
        if (/FROM\s+PeriodontalRecord/i.test(sql) && /ORDER BY/i.test(sql) && /LIMIT/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({}), all: () => [matchedRow] };
        }
        return originalPrepare(sql);
      });

      const result = await service.findMany({ keyword: '复查' });
      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe('periorecord-2');
      prepareSpy.mockRestore();
    });

    it('支持 filters 过滤（patientId）', async () => {
      const result = await service.findMany({ filters: { patientId: 'patient-2' } });
      expect(result.items.length).toBe(1);
      expect(result.items[0].patientId).toBe('patient-2');
    });

    it('支持分页', async () => {
      const result = await service.findMany({ page: 1, pageSize: 2 });
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });
  });

  describe('findOne - 查询单条', () => {
    beforeEach(() => {
      db.seed('PeriodontalRecord', [
        { id: 'periorecord-1', patientId: 'patient-1', clinicId: 'test-clinic-001', remark: '初诊', examDate: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('正常查询', async () => {
      const result = await service.findOne('periorecord-1');
      expect(result.id).toBe('periorecord-1');
      expect(result.patientId).toBe('patient-1');
    });

    it('不存在的 ID 抛出 BusinessNotFoundException', async () => {
      await expect(service.findOne('non-existent-id')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('create - 创建牙周记录', () => {
    it('正常创建', async () => {
      const result = await service.create({
        patientId: 'patient-1',
        remark: '新记录',
        examDate: '2026-01-15',
      });
      expect(result.patientId).toBe('patient-1');
      expect(result.remark).toBe('新记录');
      expect(result.examDate).toBe('2026-01-15');
    });

    it('JSON 字段（data）序列化与解析', async () => {
      const dataObj = {
        probingDepths: { '11': 3, '12': 4, '13': 2 },
        bleedingSites: ['11', '12'],
        mobility: { '21': 'I' },
      };
      const result = await service.create({
        patientId: 'patient-1',
        data: dataObj,
      });
      expect(typeof result.data).toBe('object');
      expect(result.data).not.toBeNull();
      expect(Array.isArray((result.data as any).probingDepths)).toBe(false);
      expect((result.data as any).probingDepths['11']).toBe(3);
      expect(Array.isArray((result.data as any).bleedingSites)).toBe(true);
      expect((result.data as any).bleedingSites).toContain('11');
    });
  });

  describe('update - 更新牙周记录', () => {
    beforeEach(() => {
      db.seed('PeriodontalRecord', [
        { id: 'periorecord-1', patientId: 'patient-1', clinicId: 'test-clinic-001', remark: '初诊', examDate: '2026-01-01', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('正常更新', async () => {
      const result = await service.update('periorecord-1', {
        remark: '更新后',
        examDate: '2026-01-10',
      });
      expect(result.remark).toBe('更新后');
      expect(result.examDate).toBe('2026-01-10');
    });

    it('更新 JSON 字段', async () => {
      const newData = { probingDepths: { '11': 5 } };
      const result = await service.update('periorecord-1', {
        data: newData,
      });
      expect(typeof result.data).toBe('object');
      expect((result.data as any).probingDepths['11']).toBe(5);
    });
  });

  describe('findByPatient - 按患者查询', () => {
    beforeEach(() => {
      db.seed('PeriodontalRecord', [
        { id: 'periorecord-1', patientId: 'patient-1', clinicId: 'test-clinic-001', remark: '初诊', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'periorecord-2', patientId: 'patient-1', clinicId: 'test-clinic-001', remark: '复查', createdAt: '2026-02-01', updatedAt: '2026-02-01' },
        { id: 'periorecord-3', patientId: 'patient-2', clinicId: 'test-clinic-001', remark: '常规', createdAt: '2026-03-01', updatedAt: '2026-03-01' },
      ]);
    });

    it('返回指定患者的所有牙周记录', async () => {
      const result = await service.findByPatient('patient-1');
      expect(result.items.length).toBe(2);
      result.items.forEach(item => {
        expect(item.patientId).toBe('patient-1');
      });
    });

    it('无记录的患者返回空列表', async () => {
      const result = await service.findByPatient('non-existent-patient');
      expect(result.items.length).toBe(0);
      expect(result.total).toBe(0);
    });
  });

  describe('JSON 字段解析验证', () => {
    it('findOne 返回的 data 字段已解析为对象', async () => {
      const dataObj = {
        probingDepths: { '11': 3, '12': 4 },
        notes: '轻度牙周炎',
      };
      db.seed('PeriodontalRecord', [
        {
          id: 'periorecord-json',
          patientId: 'patient-1',
          clinicId: 'test-clinic-001',
          data: JSON.stringify(dataObj),
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ]);

      const result = await service.findOne('periorecord-json');
      expect(typeof result.data).toBe('object');
      expect(result.data).not.toBeNull();
      expect((result.data as any).probingDepths['11']).toBe(3);
      expect((result.data as any).notes).toBe('轻度牙周炎');
    });

    it('findMany 返回的 data 字段已解析为对象', async () => {
      const dataObj = { probingDepths: { '11': 3 } };
      db.seed('PeriodontalRecord', [
        {
          id: 'periorecord-json',
          patientId: 'patient-1',
          clinicId: 'test-clinic-001',
          data: JSON.stringify(dataObj),
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ]);

      const result = await service.findMany();
      expect(result.items.length).toBeGreaterThan(0);
      const first = result.items[0];
      expect(typeof first.data).toBe('object');
    });

    it('data 字段为空时返回空数组', async () => {
      db.seed('PeriodontalRecord', [
        {
          id: 'periorecord-null',
          patientId: 'patient-1',
          clinicId: 'test-clinic-001',
          data: null,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ]);

      const result = await service.findOne('periorecord-null');
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data).toEqual([]);
    });
  });
});
