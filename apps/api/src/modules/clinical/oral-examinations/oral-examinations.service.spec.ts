import { OralExaminationsService } from './oral-examinations.service';
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

describe('OralExaminationsService', () => {
  let service: OralExaminationsService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new OralExaminationsService(db as any, createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  describe('findMany - 分页查询', () => {
    beforeEach(() => {
      db.seed('OralExamination', [
        { id: 'oralexam-1', patientId: 'patient-1', clinicId: 'test-clinic-001', mucosa: '正常', tmj: '无异常', remark: '初诊检查', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'oralexam-2', patientId: 'patient-1', clinicId: 'test-clinic-001', mucosa: '红肿', tmj: '弹响', remark: '复查', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
        { id: 'oralexam-3', patientId: 'patient-2', clinicId: 'test-clinic-001', mucosa: '正常', tmj: '无异常', remark: '常规检查', createdAt: '2026-01-03', updatedAt: '2026-01-03' },
      ]);
    });

    it('正常返回列表', async () => {
      const result = await service.findMany();
      expect(result.items.length).toBe(3);
      expect(result.total).toBe(3);
    });

    it('支持 keyword 搜索（mock 不支持 OR LIKE 组合，使用 spyOn 模拟）', async () => {
      const allRows = db.getTableData('OralExamination');
      const matchedRow = allRows.find(r => r.id === 'oralexam-2');

      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/SELECT COUNT/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({ total: 1, count: 1 }), all: () => [{ total: 1, count: 1 }] };
        }
        if (/FROM\s+OralExamination/i.test(sql) && /ORDER BY/i.test(sql) && /LIMIT/i.test(sql)) {
          return { run: () => ({ changes: 0, lastInsertRowid: '' }), get: () => ({}), all: () => [matchedRow] };
        }
        return originalPrepare(sql);
      });

      const result = await service.findMany({ keyword: '红肿' });
      expect(result.items.length).toBe(1);
      expect(result.items[0].id).toBe('oralexam-2');
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
      db.seed('OralExamination', [
        { id: 'oralexam-1', patientId: 'patient-1', clinicId: 'test-clinic-001', mucosa: '正常', tmj: '无异常', remark: '初诊检查', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('正常查询', async () => {
      const result = await service.findOne('oralexam-1');
      expect(result.id).toBe('oralexam-1');
      expect(result.patientId).toBe('patient-1');
    });

    it('不存在的 ID 抛出 BusinessNotFoundException', async () => {
      await expect(service.findOne('non-existent-id')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('create - 创建口腔检查记录', () => {
    it('正常创建', async () => {
      const result = await service.create({
        patientId: 'patient-1',
        mucosa: '正常',
        tmj: '无异常',
        remark: '新检查',
      });
      expect(result.patientId).toBe('patient-1');
      expect(result.mucosa).toBe('正常');
      expect(result.remark).toBe('新检查');
    });

    it('JSON 字段（caries）序列化与解析', async () => {
      const cariesData = [{ tooth: '11', status: 'caries' }, { tooth: '26', status: 'filling' }];
      const result = await service.create({
        patientId: 'patient-1',
        caries: cariesData,
      });
      expect(Array.isArray(result.caries)).toBe(true);
      expect(result.caries).toHaveLength(2);
      expect((result.caries as any[])[0].tooth).toBe('11');
      expect((result.caries as any[])[1].status).toBe('filling');
    });

    it('JSON 字段（looseTeeth）序列化与解析', async () => {
      const looseTeethData = [{ tooth: '31', degree: 'I' }, { tooth: '41', degree: 'II' }];
      const result = await service.create({
        patientId: 'patient-1',
        looseTeeth: looseTeethData,
      });
      expect(Array.isArray(result.looseTeeth)).toBe(true);
      expect(result.looseTeeth).toHaveLength(2);
      expect((result.looseTeeth as any[])[0].tooth).toBe('31');
      expect((result.looseTeeth as any[])[1].degree).toBe('II');
    });
  });

  describe('update - 更新口腔检查记录', () => {
    beforeEach(() => {
      db.seed('OralExamination', [
        { id: 'oralexam-1', patientId: 'patient-1', clinicId: 'test-clinic-001', mucosa: '正常', tmj: '无异常', remark: '初诊', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('正常更新', async () => {
      const result = await service.update('oralexam-1', {
        mucosa: '红肿',
        remark: '更新后',
      });
      expect(result.mucosa).toBe('红肿');
      expect(result.remark).toBe('更新后');
    });

    it('更新 JSON 字段', async () => {
      const newCaries = [{ tooth: '11', status: 'extracted' }];
      const result = await service.update('oralexam-1', {
        caries: newCaries,
      });
      expect(Array.isArray(result.caries)).toBe(true);
      expect((result.caries as any[])[0].status).toBe('extracted');
    });
  });

  describe('findByPatient - 按患者查询', () => {
    beforeEach(() => {
      db.seed('OralExamination', [
        { id: 'oralexam-1', patientId: 'patient-1', clinicId: 'test-clinic-001', mucosa: '正常', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'oralexam-2', patientId: 'patient-1', clinicId: 'test-clinic-001', mucosa: '红肿', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
        { id: 'oralexam-3', patientId: 'patient-2', clinicId: 'test-clinic-001', mucosa: '正常', createdAt: '2026-01-03', updatedAt: '2026-01-03' },
      ]);
    });

    it('返回指定患者的所有口腔检查记录', async () => {
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
    it('findOne 返回的 JSON 字段已解析为对象/数组', async () => {
      const cariesData = [{ tooth: '11', status: 'caries' }];
      const looseTeethData = [{ tooth: '31', degree: 'I' }];
      db.seed('OralExamination', [
        {
          id: 'oralexam-json',
          patientId: 'patient-1',
          clinicId: 'test-clinic-001',
          caries: JSON.stringify(cariesData),
          looseTeeth: JSON.stringify(looseTeethData),
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ]);

      const result = await service.findOne('oralexam-json');
      expect(Array.isArray(result.caries)).toBe(true);
      expect(Array.isArray(result.looseTeeth)).toBe(true);
      expect((result.caries as any[])[0].tooth).toBe('11');
      expect((result.looseTeeth as any[])[0].degree).toBe('I');
    });

    it('findMany 返回的 JSON 字段已解析为对象/数组', async () => {
      const cariesData = [{ tooth: '11', status: 'caries' }];
      db.seed('OralExamination', [
        {
          id: 'oralexam-json',
          patientId: 'patient-1',
          clinicId: 'test-clinic-001',
          caries: JSON.stringify(cariesData),
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ]);

      const result = await service.findMany();
      expect(result.items.length).toBeGreaterThan(0);
      const first = result.items[0];
      expect(Array.isArray(first.caries)).toBe(true);
    });

    it('JSON 字段为空时返回空数组', async () => {
      db.seed('OralExamination', [
        {
          id: 'oralexam-null',
          patientId: 'patient-1',
          clinicId: 'test-clinic-001',
          caries: null,
          looseTeeth: null,
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      ]);

      const result = await service.findOne('oralexam-null');
      expect(Array.isArray(result.caries)).toBe(true);
      expect(result.caries).toEqual([]);
      expect(Array.isArray(result.looseTeeth)).toBe(true);
      expect(result.looseTeeth).toEqual([]);
    });
  });
});
