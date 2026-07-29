import { FollowUpsService } from './follow-ups.service';
import { BusinessNotFoundException } from '@common/errors';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';


function createMockClinicContext(clinicId: string | null = 'test-clinic-001'): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('FollowUpsService', () => {
  let service: FollowUpsService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new FollowUpsService(asDbService(db), createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  // ==================== create ====================

  describe('create - 创建随访任务', () => {
    it('正常创建随访任务应返回 PENDING 状态', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        planDate: '2026-02-01',
        content: '术后一周复查',
        assigneeId: 'nurse-001',
      });

      expect(result).toBeDefined();
      expect(result.patientId).toBe('patient-001');
      expect(result.status).toBe('PENDING');
      expect(result.planDate).toBe('2026-02-01');
      expect(result.content).toBe('术后一周复查');
      expect(result.assigneeId).toBe('nurse-001');
    });

    it('不传 assigneeId 时应为空值', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        planDate: '2026-02-01',
        content: '电话回访',
      });

      // 未传入 assigneeId 时，字段不存在或为 undefined/null
      expect(result.assigneeId).toBeFalsy();
    });
  });

  // ==================== complete ====================

  describe('complete - 完成随访', () => {
    it('完成随访应设置状态为 COMPLETED 并记录结果', async () => {
      db.seed('FollowUp', [
        { id: 'fu-001', patientId: 'patient-001', planDate: '2026-02-01', content: '复查', status: 'PENDING', assigneeId: 'nurse-001', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.complete('fu-001', '患者恢复良好');

      expect(result!.status).toBe('COMPLETED');
      expect(result!.result).toBe('患者恢复良好');
      expect(result!.completedAt).toBeTruthy();
    });

    it('完成不存在的随访应抛出 BusinessNotFoundException', async () => {
      await expect(service.complete('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  // ==================== update ====================

  describe('update - 更新随访', () => {
    it('更新随访内容和计划日期应成功', async () => {
      db.seed('FollowUp', [
        { id: 'fu-002', patientId: 'patient-001', planDate: '2026-02-01', content: '复查', status: 'PENDING', assigneeId: 'nurse-001', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.update('fu-002', { content: '改为电话回访', planDate: '2026-02-15' });

      expect(result.content).toBe('改为电话回访');
      expect(result.planDate).toBe('2026-02-15');
    });
  });

  // ==================== remove ====================

  describe('remove - 删除随访', () => {
    it('删除随访应设置 deletedAt 和 CANCELLED 状态', async () => {
      db.seed('FollowUp', [
        { id: 'fu-003', patientId: 'patient-001', planDate: '2026-02-01', content: '复查', status: 'PENDING', assigneeId: 'nurse-001', clinicId: 'test-clinic-001' },
      ]);

      await service.remove('fu-003');

      const rows = db.getTableData('FollowUp');
      const deleted = rows.find(r => r.id === 'fu-003');
      expect(deleted).toBeDefined();
      expect(deleted!.deletedAt).toBeTruthy();
      expect(deleted!.status).toBe('CANCELLED');
    });
  });

  // ==================== findMany ====================

  describe('findMany - 查询随访', () => {
    beforeEach(() => {
      db.seed('FollowUp', [
        { id: 'fu-001', patientId: 'patient-001', planDate: '2026-02-01', content: '复查', status: 'PENDING', assigneeId: 'nurse-001', clinicId: 'test-clinic-001' },
        { id: 'fu-002', patientId: 'patient-002', planDate: '2026-02-02', content: '回访', status: 'COMPLETED', assigneeId: 'nurse-001', clinicId: 'test-clinic-001' },
        { id: 'fu-003', patientId: 'patient-001', planDate: '2026-02-03', content: '电话', status: 'PENDING', assigneeId: 'nurse-002', clinicId: 'test-clinic-001' },
      ]);
    });

    it('按患者查询应只返回该患者的随访', async () => {
      const result = await service.findMany({ patientId: 'patient-001' });

      expect(result.items.length).toBe(2);
      expect(result.items.every((f: any) => f.patientId === 'patient-001')).toBe(true);
    });

    it('按执行人查询应只返回该执行人的随访', async () => {
      const result = await service.findMany({ assigneeId: 'nurse-002' });

      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).assigneeId).toBe('nurse-002');
    });

    it('按状态过滤应只返回匹配状态的随访', async () => {
      const result = await service.findMany({ status: 'COMPLETED' });

      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).status).toBe('COMPLETED');
    });

    it('分页查询应返回正确的分页信息', async () => {
      const result = await service.findMany({ page: 1, pageSize: 2 });

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });

    it('组合过滤：patientId + status + assigneeId', async () => {
      const result = await service.findMany({
        patientId: 'patient-001',
        status: 'PENDING',
        assigneeId: 'nurse-001',
      });

      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).id).toBe('fu-001');
    });

    it('按 planDate ASC 排序', async () => {
      const result = await service.findMany({});
      expect(result.items.length).toBe(3);
      expect((result.items[0] as any).planDate).toBe('2026-02-01');
      expect((result.items[1] as any).planDate).toBe('2026-02-02');
      expect((result.items[2] as any).planDate).toBe('2026-02-03');
    });

    it('空表时返回空数组和 total=0', async () => {
      db.clear();
      const result = await service.findMany({});
      expect(result.items).toEqual([]);
      expect(result.total).toBe(0);
    });
  });

  // ==================== findAll ====================

  describe('findAll - 查询所有随访（调用 findMany）', () => {
    beforeEach(() => {
      db.seed('FollowUp', [
        { id: 'fu-001', patientId: 'patient-001', planDate: '2026-02-01', status: 'PENDING', clinicId: 'test-clinic-001' },
        { id: 'fu-002', patientId: 'patient-002', planDate: '2026-02-02', status: 'COMPLETED', clinicId: 'test-clinic-001' },
      ]);
    });

    it('不传参数时正常返回', async () => {
      const result = await service.findAll();
      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
    });

    it('支持分页参数', async () => {
      const result = await service.findAll({ page: 1, pageSize: 1 });
      expect(result.items.length).toBe(1);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(1);
      expect(result.total).toBe(2);
    });

    it('params 为 undefined 时正常返回', async () => {
      const result = await service.findAll();
      expect(result.items.length).toBe(2);
    });
  });

  // ==================== listResults ====================

  describe('listResults - 查询随访结果列表', () => {
    it('正常返回结果列表（使用 spyOn 模拟 FollowUpResult 表）', async () => {
      const mockResults = [
        { id: 'r1', name: '恢复良好', category: 'positive' },
        { id: 'r2', name: '需要复诊', category: 'warning' },
      ];
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+FollowUpResult/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => mockResults[0],
            all: () => mockResults,
          };
        }
        return originalPrepare(sql);
      });

      const result = await service.listResults();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect((result[0] as any).name).toBe('恢复良好');
      prepareSpy.mockRestore();
    });

    it('空结果时返回空数组', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+FollowUpResult/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => null,
            all: () => [],
          };
        }
        return originalPrepare(sql);
      });

      const result = await service.listResults();
      expect(result).toEqual([]);
      prepareSpy.mockRestore();
    });
  });

  // ==================== listItems ====================

  describe('listItems - 查询随访模板项', () => {
    it('根据 templateId 返回对应的项列表', async () => {
      const mockItems = [
        { id: 'i1', templateId: 'tpl-001', content: '项1', sortOrder: 1 },
        { id: 'i2', templateId: 'tpl-001', content: '项2', sortOrder: 2 },
      ];
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+FollowUpItem/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => mockItems[0],
            all: () => mockItems,
          };
        }
        return originalPrepare(sql);
      });

      const result = await service.listItems('tpl-001');
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
      expect((result[0] as any).templateId).toBe('tpl-001');
      prepareSpy.mockRestore();
    });

    it('templateId 无匹配时返回空数组', async () => {
      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/FROM\s+FollowUpItem/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => null,
            all: () => [],
          };
        }
        return originalPrepare(sql);
      });

      const result = await service.listItems('non-existent');
      expect(result).toEqual([]);
      prepareSpy.mockRestore();
    });
  });

  // ==================== listTemplates ====================

  describe('listTemplates - 查询随访模板列表', () => {
    beforeEach(() => {
      db.seed('FollowUpTemplate', [
        { id: 'tpl-001', name: '术后随访模板', clinicId: 'test-clinic-001', createdAt: '2026-01-15' },
        { id: 'tpl-002', name: '常规回访模板', clinicId: 'test-clinic-001', createdAt: '2026-01-20' },
      ]);
    });

    it('正常返回模板列表', async () => {
      const result = await service.listTemplates();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('按 createdAt DESC 排序', async () => {
      const result = await service.listTemplates();
      expect((result[0] as any).createdAt).toBe('2026-01-20');
      expect((result[1] as any).createdAt).toBe('2026-01-15');
    });

    it('空表时返回空数组', async () => {
      db.clear();
      const result = await service.listTemplates();
      expect(result).toEqual([]);
    });
  });

  // ==================== listAutoRules ====================

  describe('listAutoRules - 查询自动随访规则', () => {
    beforeEach(() => {
      db.seed('AutoFollowUpRule', [
        { id: 'rule-001', name: '术后一周自动随访', clinicId: 'test-clinic-001', createdAt: '2026-01-10' },
        { id: 'rule-002', name: '正畸月度回访', clinicId: 'test-clinic-001', createdAt: '2026-01-12' },
      ]);
    });

    it('正常返回规则列表', async () => {
      const result = await service.listAutoRules();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('按 createdAt DESC 排序', async () => {
      const result = await service.listAutoRules();
      expect((result[0] as any).createdAt).toBe('2026-01-12');
      expect((result[1] as any).createdAt).toBe('2026-01-10');
    });

    it('空表时返回空数组', async () => {
      db.clear();
      const result = await service.listAutoRules();
      expect(result).toEqual([]);
    });
  });

  // ==================== complete 边界情况 ====================

  describe('complete - 完成随访（边界情况）', () => {
    beforeEach(() => {
      db.seed('FollowUp', [
        { id: 'fu-001', patientId: 'patient-001', planDate: '2026-02-01', status: 'PENDING', clinicId: 'test-clinic-001' },
      ]);
    });

    it('不传 result 时 result 为 null', async () => {
      const result = await service.complete('fu-001');
      expect(result!.status).toBe('COMPLETED');
      expect(result!.result).toBeNull();
      expect(result!.completedAt).toBeTruthy();
    });

    it('事务内写入审计日志', async () => {
      const transactionSpy = jest.spyOn(db, 'transaction');
      await service.complete('fu-001', '很好');
      expect(transactionSpy).toHaveBeenCalled();
      transactionSpy.mockRestore();
    });
  });

  // ==================== update 边界情况 ====================

  describe('update - 更新随访（边界情况）', () => {
    beforeEach(() => {
      db.seed('FollowUp', [
        { id: 'fu-001', patientId: 'patient-001', planDate: '2026-02-01', content: '原内容', status: 'PENDING', assigneeId: 'nurse-001', clinicId: 'test-clinic-001' },
      ]);
    });

    it('只更新 status 字段', async () => {
      const result = await service.update('fu-001', { status: 'IN_PROGRESS' });
      expect(result.status).toBe('IN_PROGRESS');
      expect(result.content).toBe('原内容');
    });

    it('只更新 assigneeId 字段', async () => {
      const result = await service.update('fu-001', { assigneeId: 'doctor-001' });
      expect(result.assigneeId).toBe('doctor-001');
    });

    it('更新不存在的随访抛出 BusinessNotFoundException', async () => {
      await expect(service.update('non-existent', { content: 'test' })).rejects.toThrow(BusinessNotFoundException);
    });

    it('事务内写入审计日志', async () => {
      const transactionSpy = jest.spyOn(db, 'transaction');
      await service.update('fu-001', { content: '新内容' });
      expect(transactionSpy).toHaveBeenCalled();
      transactionSpy.mockRestore();
    });
  });

  // ==================== remove 边界情况 ====================

  describe('remove - 删除随访（边界情况）', () => {
    beforeEach(() => {
      db.seed('FollowUp', [
        { id: 'fu-001', patientId: 'patient-001', planDate: '2026-02-01', status: 'PENDING', clinicId: 'test-clinic-001' },
      ]);
    });

    it('软删除后 deletedAt 被设置（mock 对 id 查询有特殊处理，使用 spyOn 验证软删除过滤）', async () => {
      await service.remove('fu-001');
      const rows = db.getTableData('FollowUp');
      const deleted = rows.find(r => r.id === 'fu-001');
      expect(deleted).toBeDefined();
      expect(deleted?.deletedAt).toBeTruthy();
      expect(deleted?.status).toBe('CANCELLED');

      const originalPrepare = db.prepare.bind(db);
      const prepareSpy = jest.spyOn(db, 'prepare').mockImplementation((sql: string) => {
        if (/WHERE\s+id\s*=\s*\?/i.test(sql) && /deletedAt\s+IS\s+NULL/i.test(sql)) {
          return {
            run: () => ({ changes: 0, lastInsertRowid: '' }),
            get: () => null,
            all: () => [],
          };
        }
        return originalPrepare(sql);
      });

      await expect(service.findOne('fu-001')).rejects.toThrow(BusinessNotFoundException);
      prepareSpy.mockRestore();
    });
  });
});
