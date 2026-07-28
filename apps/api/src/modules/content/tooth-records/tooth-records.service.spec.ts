import { ToothRecordsService } from './tooth-records.service';
import { BusinessValidationException } from '@common/errors';
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

describe('ToothRecordsService', () => {
  let service: ToothRecordsService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new ToothRecordsService(db as any, createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  describe('findByTooth - 按牙位查询', () => {
    beforeEach(() => {
      db.seed('ToothRecord', [
        { id: 'toothrecord-001', patientId: 'patient-001', toothNumber: 11, currentStatus: 'SOUND', conditions: '["CARIES"]', remark: null, clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'toothrecord-002', patientId: 'patient-001', toothNumber: 12, currentStatus: 'RESTORED', conditions: '[]', remark: '已充填', clinicId: 'test-clinic-001', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
      ]);
    });

    it('正常查询指定牙位记录', async () => {
      const result = await service.findByTooth('patient-001', 11);
      expect(result).toBeDefined();
      expect((result as any).toothNumber).toBe(11);
      expect((result as any).currentStatus).toBe('SOUND');
    });

    it('conditions JSON 字段被正确解析为数组', async () => {
      const result = await service.findByTooth('patient-001', 11);
      expect(Array.isArray((result as any).conditions)).toBe(true);
      expect((result as any).conditions).toEqual(['CARIES']);
    });

    it('不存在的牙位返回 undefined', async () => {
      const result = await service.findByTooth('patient-001', 13);
      expect(result).toBeUndefined();
    });

    it('无效牙位号抛出 BusinessValidationException', async () => {
      await expect(service.findByTooth('patient-001', 99)).rejects.toThrow(BusinessValidationException);
      await expect(service.findByTooth('patient-001', 0)).rejects.toThrow(BusinessValidationException);
      await expect(service.findByTooth('patient-001', 10)).rejects.toThrow(BusinessValidationException);
    });

    it('有效牙位号不抛异常（恒牙：11-18,21-28,31-38,41-48）', async () => {
      const validNumbers = [11, 18, 21, 28, 31, 38, 41, 48];
      for (const n of validNumbers) {
        await expect(service.findByTooth('patient-001', n)).resolves.not.toThrow(BusinessValidationException);
      }
    });

    it('有效牙位号不抛异常（乳牙：51-55,61-65,71-75,81-85）', async () => {
      const validNumbers = [51, 55, 61, 65, 71, 75, 81, 85];
      for (const n of validNumbers) {
        await expect(service.findByTooth('patient-001', n)).resolves.not.toThrow(BusinessValidationException);
      }
    });
  });

  describe('upsert - 插入或更新', () => {
    it('插入新记录（记录不存在时）', async () => {
      const result = await service.upsert('patient-001', 11, {
        currentStatus: 'CARIES',
        conditions: ['DECAY'],
        remark: '浅龋',
      });
      expect(result).toBeDefined();
      expect((result as any).toothNumber).toBe(11);
      expect((result as any).currentStatus).toBe('CARIES');
      expect((result as any).remark).toBe('浅龋');
    });

    it('conditions JSON 字段在插入后被正确解析', async () => {
      const result = await service.upsert('patient-001', 11, {
        currentStatus: 'CARIES',
        conditions: ['DECAY', 'SENSITIVE'],
      });
      expect(Array.isArray((result as any).conditions)).toBe(true);
      expect((result as any).conditions).toEqual(['DECAY', 'SENSITIVE']);
    });

    it('更新已有记录', async () => {
      db.seed('ToothRecord', [
        { id: 'toothrecord-001', patientId: 'patient-001', toothNumber: 11, currentStatus: 'SOUND', conditions: '[]', remark: null, clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);

      const result = await service.upsert('patient-001', 11, {
        currentStatus: 'RESTORED',
        conditions: ['FILLING'],
        remark: '树脂充填',
      });
      expect((result as any).currentStatus).toBe('RESTORED');
      expect((result as any).remark).toBe('树脂充填');
    });

    it('默认 currentStatus 为 SOUND', async () => {
      const result = await service.upsert('patient-001', 11, {});
      expect((result as any).currentStatus).toBe('SOUND');
    });

    it('默认 conditions 为空数组', async () => {
      const result = await service.upsert('patient-001', 11, {});
      expect(Array.isArray((result as any).conditions)).toBe(true);
      expect((result as any).conditions).toEqual([]);
    });

    it('无效牙位号抛出 BusinessValidationException', async () => {
      await expect(service.upsert('patient-001', 99, {})).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('removeByTooth - 按牙位软删除', () => {
    beforeEach(() => {
      db.seed('ToothRecord', [
        { id: 'toothrecord-001', patientId: 'patient-001', toothNumber: 11, currentStatus: 'SOUND', conditions: '[]', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('正常软删除并返回 success: true', async () => {
      const result = await service.removeByTooth('patient-001', 11);
      expect(result).toEqual({ success: true });
    });

    it('删除后 findByTooth 找不到记录', async () => {
      await service.removeByTooth('patient-001', 11);
      const record = await service.findByTooth('patient-001', 11);
      expect(record).toBeUndefined();
    });

    it('无效牙位号抛出 BusinessValidationException', async () => {
      await expect(service.removeByTooth('patient-001', 99)).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('findByPatient - 按患者查询', () => {
    beforeEach(() => {
      db.seed('ToothRecord', [
        { id: 'toothrecord-001', patientId: 'patient-001', toothNumber: 11, currentStatus: 'SOUND', conditions: '[]', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
        { id: 'toothrecord-002', patientId: 'patient-001', toothNumber: 12, currentStatus: 'CARIES', conditions: '["DECAY"]', clinicId: 'test-clinic-001', createdAt: '2026-01-02', updatedAt: '2026-01-02' },
        { id: 'toothrecord-003', patientId: 'patient-002', toothNumber: 11, currentStatus: 'SOUND', conditions: '[]', clinicId: 'test-clinic-001', createdAt: '2026-01-03', updatedAt: '2026-01-03' },
      ]);
    });

    it('返回指定患者的所有牙位记录', async () => {
      const result = await service.findByPatient('patient-001');
      expect(result.items.length).toBe(2);
    });

    it('按 toothNumber 升序排序', async () => {
      const result = await service.findByPatient('patient-001');
      expect((result.items[0] as any).toothNumber).toBe(11);
      expect((result.items[1] as any).toothNumber).toBe(12);
    });

    it('conditions JSON 字段被正确解析', async () => {
      const result = await service.findByPatient('patient-001');
      const itemWithConditions = result.items.find((i: any) => i.toothNumber === 12);
      expect(Array.isArray((itemWithConditions as any).conditions)).toBe(true);
      expect((itemWithConditions as any).conditions).toEqual(['DECAY']);
    });
  });

  describe('BaseService 继承方法', () => {
    beforeEach(() => {
      db.seed('ToothRecord', [
        { id: 'toothrecord-001', patientId: 'patient-001', toothNumber: 11, currentStatus: 'SOUND', conditions: '[]', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('findOne 正常查询', async () => {
      const result = await service.findOne('toothrecord-001');
      expect((result as any).id).toBe('toothrecord-001');
    });

    it('create 正常创建', async () => {
      const result = await service.create({
        patientId: 'patient-002',
        toothNumber: 21,
        currentStatus: 'SOUND',
      });
      expect((result as any).toothNumber).toBe(21);
    });
  });

  // ==================== 边界分支补充 ====================

  describe('边界分支 - upsert 更新路径默认值', () => {
    beforeEach(() => {
      db.seed('ToothRecord', [
        { id: 'toothrecord-001', patientId: 'patient-001', toothNumber: 11, currentStatus: 'CARIES', conditions: '["OLD"]', remark: '旧备注', clinicId: 'test-clinic-001', createdAt: '2026-01-01', updatedAt: '2026-01-01' },
      ]);
    });

    it('更新时 data 为空对象应使用默认值 currentStatus=SOUND, conditions=[], remark=null', async () => {
      const result = await service.upsert('patient-001', 11, {});
      // 验证更新后的默认值
      expect((result as any).currentStatus).toBe('SOUND');
      expect(Array.isArray((result as any).conditions)).toBe(true);
      expect((result as any).conditions).toEqual([]);
      expect((result as any).remark).toBeNull();
    });

    it('更新时 currentStatus 为 undefined 应默认为 SOUND', async () => {
      const result = await service.upsert('patient-001', 11, {
        conditions: ['NEW'],
        remark: '新备注',
      });
      expect((result as any).currentStatus).toBe('SOUND');
    });

    it('更新时 conditions 为 undefined 应默认为空数组', async () => {
      const result = await service.upsert('patient-001', 11, {
        currentStatus: 'RESTORED',
        remark: '新备注',
      });
      expect(Array.isArray((result as any).conditions)).toBe(true);
      expect((result as any).conditions).toEqual([]);
    });

    it('更新时 remark 为 undefined 应默认为 null', async () => {
      const result = await service.upsert('patient-001', 11, {
        currentStatus: 'RESTORED',
        conditions: ['FILLING'],
      });
      expect((result as any).remark).toBeNull();
    });
  });

  describe('边界分支 - clinicId 为 null 时插入', () => {
    it('clinicId 为 null 时 INSERT 路径的 clinicId 应存储为 null', async () => {
      // buildClinicClause 在 clinicId 为 null 时会抛出异常，
      // 需 mock 该方法返回空子句以覆盖 clinicId || null 分支
      const nullCtxService = new ToothRecordsService(db as any, createMockClinicContext(null));
      jest.spyOn(nullCtxService as any, 'buildClinicClause').mockReturnValue({ clause: '', params: [] });

      const result = await nullCtxService.upsert('patient-001', 11, {
        currentStatus: 'CARIES',
        conditions: ['DECAY'],
        remark: '测试',
      });

      // 验证记录的 clinicId 为 null（clinicId || null 的 null 分支被覆盖）
      expect((result as any).clinicId).toBeNull();

      // 数据库中的记录 clinicId 也应为 null
      const records = db.getTableData('ToothRecord');
      expect(records.length).toBe(1);
      expect(records[0].clinicId).toBeNull();
    });
  });
});
