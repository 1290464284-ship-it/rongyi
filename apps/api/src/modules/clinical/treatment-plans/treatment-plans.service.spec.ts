import { TreatmentPlansService } from './treatment-plans.service';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';
import { asDbService, MockDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';


function createMockClinicContext(): ClinicContextService {
  return {
    getClinicId: () => 'test-clinic-001',
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('TreatmentPlansService', () => {
  let service: TreatmentPlansService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    // Seed Patient and User records for FK validation
    db.seed('Patient', [
      { id: 'patient-001', code: 'P001', name: '测试患者1', gender: 'MALE', phone: '13800000000', tags: '[]', allergies: '[]', medicalHistory: '[]', medicationHistory: '[]', systemicDiseases: '[]', source: 'WALK_IN', active: 1, clinicId: 'test-clinic-001', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'patient-002', code: 'P002', name: '测试患者2', gender: 'FEMALE', phone: '13800000001', tags: '[]', allergies: '[]', medicalHistory: '[]', medicationHistory: '[]', systemicDiseases: '[]', source: 'WALK_IN', active: 1, clinicId: 'test-clinic-001', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'p1', code: 'P003', name: '计划患者1', gender: 'MALE', phone: '13800000002', tags: '[]', allergies: '[]', medicalHistory: '[]', medicationHistory: '[]', systemicDiseases: '[]', source: 'WALK_IN', active: 1, clinicId: 'test-clinic-001', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'p2', code: 'P004', name: '计划患者2', gender: 'MALE', phone: '13800000003', tags: '[]', allergies: '[]', medicalHistory: '[]', medicationHistory: '[]', systemicDiseases: '[]', source: 'WALK_IN', active: 1, clinicId: 'test-clinic-001', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    db.seed('User', [
      { id: 'doctor-001', username: 'doctor1', name: '测试医生1', role: 'DOCTOR', active: 1, clinicId: 'test-clinic-001', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
      { id: 'd1', username: 'doctor_d1', name: '计划医生1', role: 'DOCTOR', active: 1, clinicId: 'test-clinic-001', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
    ]);
    service = new TreatmentPlansService(asDbService(db), createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  // ==================== create ====================

  describe('create - 治疗计划创建', () => {
    it('正常创建治疗计划（含明细项）', async () => {
      const dto = {
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        name: '正畸治疗计划',
        totalFee: 5000,
        remark: '年度正畸方案',
        items: [
          { code: 'T001', name: '初诊检查', category: '检查', price: 200, quantity: 1, teethNumbers: [], remark: '' },
          { code: 'T002', name: '拍片', category: '影像', price: 300, quantity: 1, teethNumbers: [], remark: '' },
        ],
      };

      const result = await service.create(dto);

      expect(result).toBeDefined();
      expect(result.name).toBe('正畸治疗计划');
      expect(result.status).toBe('DRAFT');

      const planItems = db.getTableData('TreatmentPlanItem');
      expect(planItems.length).toBe(2);
    });

    it('治疗计划明细为空应抛出 BusinessValidationException', async () => {
      const dto = {
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        name: '空计划',
        items: [],
      };

      await expect(service.create(dto as any)).rejects.toThrow(BusinessValidationException);
    });

    it('治疗计划明细为 undefined 应抛出 BusinessValidationException', async () => {
      const dto = {
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        name: '无明细计划',
      };

      await expect(service.create(dto as any)).rejects.toThrow(BusinessValidationException);
    });

    it('创建治疗计划时使用默认值（totalFee=0, remark=null）', async () => {
      const dto = {
        patientId: 'patient-002',
        doctorId: 'doctor-001',
        name: '基础计划',
        items: [
          { code: 'T001', name: '检查', category: '检查', price: 100 },
        ],
      };

      const result = await service.create(dto);

      expect(result).toBeDefined();
      expect(result.name).toBe('基础计划');

      const planItems = db.getTableData('TreatmentPlanItem');
      expect(planItems.length).toBe(1);
      expect(planItems[0].code).toBe('T001');
      expect(planItems[0].quantity).toBe(1);
    });

    it('创建治疗计划时应包含 clinicId', async () => {
      const dto = {
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        name: '测试计划',
        items: [
          { code: 'T001', name: '检查', category: '检查', price: 100 },
        ],
      };

      const _result = await service.create(dto);

      const planItems = db.getTableData('TreatmentPlanItem');
      expect(planItems[0].clinicId).toBe('test-clinic-001');
    });

    it('明细项 teethNumbers 应被存储为 JSON 字符串', async () => {
      const dto = {
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        name: '牙齿计划',
        items: [
          { code: 'T001', name: '补牙', category: '修复', price: 300, teethNumbers: [11, 12, 21] },
        ],
      };

      await service.create(dto);

      const planItems = db.getTableData('TreatmentPlanItem');
      expect(planItems[0].teethNumbers).toBe('[11,12,21]');
    });
  });

  // ==================== updateStatus ====================

  describe('updateStatus - 更新计划状态', () => {
    it('DRAFT → SUBMITTED 应成功', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'DRAFT', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateStatus('plan-001', { status: 'SUBMITTED' });

      expect(result.status).toBe('SUBMITTED');
    });

    it('DRAFT → SUBMITTED → APPROVED 完整流转应成功', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'DRAFT', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      await service.updateStatus('plan-001', { status: 'SUBMITTED' });
      const result = await service.updateStatus('plan-001', { status: 'APPROVED' });

      expect(result.status).toBe('APPROVED');
    });

    it('DRAFT → APPROVED 非法流转应抛出 BusinessValidationException', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'DRAFT', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      await expect(
        service.updateStatus('plan-001', { status: 'APPROVED' }),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('DRAFT → CANCELLED 应成功', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'DRAFT', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateStatus('plan-001', { status: 'CANCELLED' });

      expect(result.status).toBe('CANCELLED');
    });

    it('SUBMITTED → APPROVED 应成功', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'SUBMITTED', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateStatus('plan-001', { status: 'APPROVED' });

      expect(result.status).toBe('APPROVED');
    });

    it('SUBMITTED → REJECTED 应成功', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'SUBMITTED', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateStatus('plan-001', { status: 'REJECTED' });

      expect(result.status).toBe('REJECTED');
    });

    it('REJECTED → DRAFT 应成功（可重新编辑）', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'REJECTED', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateStatus('plan-001', { status: 'DRAFT' });

      expect(result.status).toBe('DRAFT');
    });

    it('APPROVED → IN_PROGRESS 应成功', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'APPROVED', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateStatus('plan-001', { status: 'IN_PROGRESS' });

      expect(result.status).toBe('IN_PROGRESS');
    });

    it('IN_PROGRESS → COMPLETED 应成功', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'IN_PROGRESS', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateStatus('plan-001', { status: 'COMPLETED' });

      expect(result.status).toBe('COMPLETED');
    });

    it('CANCELLED → DRAFT 应成功（可重新启用）', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'CANCELLED', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateStatus('plan-001', { status: 'DRAFT' });

      expect(result.status).toBe('DRAFT');
    });

    it('非法状态流转 DRAFT → COMPLETED 应抛出 BusinessValidationException', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'DRAFT', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      await expect(
        service.updateStatus('plan-001', { status: 'COMPLETED' }),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('非法状态流转 APPROVED → DRAFT 应抛出 BusinessValidationException', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'APPROVED', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      await expect(
        service.updateStatus('plan-001', { status: 'DRAFT' }),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('COMPLETED 是终态，不应流转到任何状态', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'COMPLETED', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      await expect(
        service.updateStatus('plan-001', { status: 'IN_PROGRESS' }),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('更新不存在的计划应抛出异常', async () => {
      await expect(
        service.updateStatus('non-existent', { status: 'APPROVED' }),
      ).rejects.toThrow();
    });

    it('更新计划状态应写入审计日志', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'DRAFT', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      await service.updateStatus('plan-001', { status: 'SUBMITTED' });

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === 'plan-001' && l.type === 'TREATMENT_PLAN_STATUS_UPDATE');
      expect(log).toBeDefined();
    });
  });

  // ==================== updateItemStatus ====================

  describe('updateItemStatus - 更新计划项状态', () => {
    it('正常更新计划项状态', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'DRAFT', clinicId: 'test-clinic-001' },
      ]);
      db.seed('TreatmentPlanItem', [
        { id: 'item-001', planId: 'plan-001', code: 'T001', name: '项目1', category: '检查', price: 100, quantity: 1, teethNumbers: '[]', status: 'PLANNED', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateItemStatus('plan-001', 'item-001', { status: 'IN_PROGRESS' });

      expect(result).toBeDefined();
      expect(result!.status).toBe('IN_PROGRESS');
    });

    it('更新计划项状态为 COMPLETED', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-002', patientId: 'p1', doctorId: 'd1', name: '计划2', status: 'IN_PROGRESS', clinicId: 'test-clinic-001' },
      ]);
      db.seed('TreatmentPlanItem', [
        { id: 'item-002', planId: 'plan-002', code: 'T002', name: '项目2', category: '治疗', price: 500, quantity: 1, teethNumbers: '[]', status: 'IN_PROGRESS', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateItemStatus('plan-002', 'item-002', { status: 'COMPLETED' });

      expect(result).toBeDefined();
      expect(result!.status).toBe('COMPLETED');
    });

    it('计划项 teethNumbers 为 JSON 字符串应正确解析', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-003', patientId: 'p1', doctorId: 'd1', name: '计划3', status: 'DRAFT', clinicId: 'test-clinic-001' },
      ]);
      db.seed('TreatmentPlanItem', [
        { id: 'item-003', planId: 'plan-003', code: 'T003', name: '项目3', category: '治疗', price: 800, quantity: 1, teethNumbers: '[11,12,13]', status: 'PLANNED', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateItemStatus('plan-003', 'item-003', { status: 'IN_PROGRESS' });

      expect(result).toBeDefined();
      expect(Array.isArray(result!.teethNumbers)).toBe(true);
      expect(result!.teethNumbers).toEqual([11, 12, 13]);
    });

    it('更新不存在的计划项应抛出 BusinessNotFoundException', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'DRAFT', clinicId: 'test-clinic-001' },
      ]);

      await expect(
        service.updateItemStatus('plan-001', 'non-existent', { status: 'IN_PROGRESS' }),
      ).rejects.toThrow('治疗计划明细不存在');
    });

    it('更新计划项状态应写入审计日志', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'DRAFT', clinicId: 'test-clinic-001' },
      ]);
      db.seed('TreatmentPlanItem', [
        { id: 'item-001', planId: 'plan-001', code: 'T001', name: '项目1', category: '检查', price: 100, quantity: 1, teethNumbers: '[]', status: 'PLANNED', clinicId: 'test-clinic-001' },
      ]);

      await service.updateItemStatus('plan-001', 'item-001', { status: 'IN_PROGRESS' });

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === 'item-001' && l.type === 'TREATMENT_PLAN_ITEM_STATUS_UPDATE');
      expect(log).toBeDefined();
    });
  });

  // ==================== findOne ====================

  describe('findOne - 查询单个治疗计划', () => {
    it('查询存在的治疗计划', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '测试计划', status: 'DRAFT', totalFee: 1000, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.findOne('plan-001');

      expect(result).toBeDefined();
      expect(result.name).toBe('测试计划');
    });

    it('查询不存在的计划应抛出 BusinessNotFoundException', async () => {
      await expect(service.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  // ==================== findMany ====================

  describe('findMany - 分页查询治疗计划', () => {
    it('获取治疗计划列表', async () => {
      db.seed('TreatmentPlan', [
        { id: 'plan-001', patientId: 'p1', doctorId: 'd1', name: '计划1', status: 'DRAFT', clinicId: 'test-clinic-001' },
        { id: 'plan-002', patientId: 'p2', doctorId: 'd1', name: '计划2', status: 'COMPLETED', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.findMany({});

      expect(result.items.length).toBeGreaterThanOrEqual(2);
      expect(result.total).toBeGreaterThanOrEqual(2);
    });
  });
});
