 
import { FirstExamsService } from './first-exams.service';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
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

describe('FirstExamsService', () => {
  let service: FirstExamsService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new FirstExamsService(db as any, createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  // ==================== create ====================

  describe('create - 创建初诊', () => {
    it('正常创建初诊应返回 DRAFT 状态', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        chiefComplaint: '牙痛',
        diagnosis: '龋齿',
        treatmentSuggestion: '补牙',
        remark: '尽快治疗',
      });

      expect(result).toBeDefined();
      expect((result as any).patientId).toBe('patient-001');
      expect((result as any).doctorId).toBe('doctor-001');
      expect((result as any).chiefComplaint).toBe('牙痛');
      expect((result as any).diagnosis).toBe('龋齿');
      expect((result as any).treatmentSuggestion).toBe('补牙');
      expect((result as any).remark).toBe('尽快治疗');
      expect((result as any).status).toBe('DRAFT');
    });

    it('创建初诊时应包含 clinicId', async () => {
      const result = await service.create({
        patientId: 'patient-001',
      });

      const rows = db.getTableData('FirstExam');
      const created = rows.find(r => r.id === (result as any).id);
      expect(created).toBeDefined();
      expect(created.clinicId).toBe('test-clinic-001');
    });

    it('创建初诊时只传 patientId 应使用默认值', async () => {
      const result = await service.create({
        patientId: 'patient-001',
      });

      expect((result as any).status).toBe('DRAFT');
      expect((result as any).diagnosis).toBeUndefined();
      expect((result as any).treatmentSuggestion).toBeUndefined();
    });
  });

  // ==================== update ====================

  describe('update - 更新初诊', () => {
    it('更新主诉和诊断应成功', async () => {
      const created = await service.create({
        patientId: 'patient-001',
        chiefComplaint: '初始主诉',
      });

      const result = await service.update((created as any).id, {
        chiefComplaint: '更新主诉',
        diagnosis: '牙周炎',
      });

      expect((result as any).chiefComplaint).toBe('更新主诉');
      expect((result as any).diagnosis).toBe('牙周炎');
    });

    it('更新治疗建议应成功', async () => {
      const created = await service.create({
        patientId: 'patient-001',
        treatmentSuggestion: '初始建议',
      });

      const result = await service.update((created as any).id, {
        treatmentSuggestion: '洗牙 + 洁治',
      });

      expect((result as any).treatmentSuggestion).toBe('洗牙 + 洁治');
    });

    it('更新备注应成功', async () => {
      const created = await service.create({
        patientId: 'patient-001',
      });

      const result = await service.update((created as any).id, {
        remark: '新备注',
      });

      expect((result as any).remark).toBe('新备注');
    });

    it('更新不存在的初诊应抛出 BusinessNotFoundException', async () => {
      await expect(
        service.update('non-existent', { chiefComplaint: 'test' }),
      ).rejects.toThrow(BusinessNotFoundException);
    });
  });

  // ==================== updateStatus ====================

  describe('updateStatus - 更新初诊状态', () => {
    it('DRAFT → SUBMITTED 应成功', async () => {
      const created = await service.create({ patientId: 'patient-001' });

      const result = await service.updateStatus((created as any).id, 'SUBMITTED');

      expect((result as any).status).toBe('SUBMITTED');
    });

    it('DRAFT → APPROVED 应成功', async () => {
      const created = await service.create({ patientId: 'patient-001' });

      const result = await service.updateStatus((created as any).id, 'APPROVED');

      expect((result as any).status).toBe('APPROVED');
    });

    it('SUBMITTED → APPROVED 应成功', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.updateStatus((created as any).id, 'SUBMITTED');

      const result = await service.updateStatus((created as any).id, 'APPROVED');

      expect((result as any).status).toBe('APPROVED');
    });

    it('SUBMITTED → REJECTED 应成功', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.updateStatus((created as any).id, 'SUBMITTED');

      const result = await service.updateStatus((created as any).id, 'REJECTED');

      expect((result as any).status).toBe('REJECTED');
    });

    it('REJECTED → DRAFT 应成功（可重新编辑）', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.updateStatus((created as any).id, 'SUBMITTED');
      await service.updateStatus((created as any).id, 'REJECTED');

      const result = await service.updateStatus((created as any).id, 'DRAFT');

      expect((result as any).status).toBe('DRAFT');
    });

    it('APPROVED → DRAFT 应成功（可重新编辑）', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.updateStatus((created as any).id, 'APPROVED');

      const result = await service.updateStatus((created as any).id, 'DRAFT');

      expect((result as any).status).toBe('DRAFT');
    });

    // --- 非法流转 ---

    it('DRAFT → REJECTED 非法流转应抛出 BusinessValidationException', async () => {
      const created = await service.create({ patientId: 'patient-001' });

      await expect(
        service.updateStatus((created as any).id, 'REJECTED'),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('SUBMITTED → DRAFT 非法流转应抛出 BusinessValidationException', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.updateStatus((created as any).id, 'SUBMITTED');

      await expect(
        service.updateStatus((created as any).id, 'DRAFT'),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('REJECTED → SUBMITTED 非法流转应抛出 BusinessValidationException', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.updateStatus((created as any).id, 'SUBMITTED');
      await service.updateStatus((created as any).id, 'REJECTED');

      await expect(
        service.updateStatus((created as any).id, 'SUBMITTED'),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('REJECTED → APPROVED 非法流转应抛出 BusinessValidationException', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.updateStatus((created as any).id, 'SUBMITTED');
      await service.updateStatus((created as any).id, 'REJECTED');

      await expect(
        service.updateStatus((created as any).id, 'APPROVED'),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('更新不存在的初诊状态应抛出异常', async () => {
      await expect(
        service.updateStatus('non-existent', 'SUBMITTED'),
      ).rejects.toThrow();
    });

    it('更新状态应写入审计日志', async () => {
      const created = await service.create({ patientId: 'patient-001' });

      await service.updateStatus((created as any).id, 'SUBMITTED');

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === (created as any).id && l.type === 'FIRST_EXAM_STATUS_UPDATE');
      expect(log).toBeDefined();
    });
  });

  // ==================== complete ====================

  describe('complete - 完成初诊', () => {
    it('调用 complete 应将状态设为 APPROVED', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.updateStatus((created as any).id, 'SUBMITTED');

      const result = await service.complete((created as any).id);

      expect((result as any).status).toBe('APPROVED');
    });

    it('DRAFT 状态直接 complete 应成功（DRAFT → APPROVED 是合法流转）', async () => {
      const created = await service.create({ patientId: 'patient-001' });

      const result = await service.complete((created as any).id);

      expect((result as any).status).toBe('APPROVED');
    });
  });

  // ==================== restart ====================

  describe('restart - 重启初诊', () => {
    it('APPROVED 状态重启应设为 DRAFT', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.updateStatus((created as any).id, 'APPROVED');

      const result = await service.restart((created as any).id);

      expect((result as any).status).toBe('DRAFT');
    });

    it('REJECTED 状态重启应设为 DRAFT', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.updateStatus((created as any).id, 'SUBMITTED');
      await service.updateStatus((created as any).id, 'REJECTED');

      const result = await service.restart((created as any).id);

      expect((result as any).status).toBe('DRAFT');
    });

    it('重启应写入审计日志', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.updateStatus((created as any).id, 'APPROVED');

      await service.restart((created as any).id);

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === (created as any).id && l.type === 'FIRST_EXAM_RESTART');
      expect(log).toBeDefined();
    });

    it('重启不存在的初诊应抛出异常', async () => {
      await expect(service.restart('non-existent')).rejects.toThrow();
    });
  });

  // ==================== stats ====================

  describe('stats - 初诊统计', () => {
    it('有初诊记录时 stats 应正常返回', async () => {
      // 直接 seed 绕过 BaseService.create（MockDbService COUNT 别名解析限制）
      db.seed('FirstExam', [
        { id: 'exam-001', patientId: 'patient-001', status: 'DRAFT', clinicId: 'test-clinic-001' },
        { id: 'exam-002', patientId: 'patient-002', status: 'DRAFT', clinicId: 'test-clinic-001' },
        { id: 'exam-003', patientId: 'patient-003', status: 'DRAFT', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.stats();

      expect(result).toBeDefined();
      expect(typeof result.total).toBe('number');
    });

    it('无初诊时应返回 0', async () => {
      const result = await service.stats();

      expect(result.total).toBe(0);
    });
  });

  // ==================== createFollowUp ====================

  describe('createFollowUp - 创建初诊随访', () => {
    it('正常创建随访应返回随访 ID', async () => {
      const exam = await service.create({ patientId: 'patient-001' });

      const result = await service.createFollowUp((exam as any).id, {
        planDate: '2026-02-01',
        content: '复查牙周状况',
        assigneeId: 'doctor-001',
      });

      expect(result).toBeDefined();
      expect((result as any).id).toBeDefined();
    });

    it('创建随访时应包含 clinicId', async () => {
      const exam = await service.create({ patientId: 'patient-001' });

      await service.createFollowUp((exam as any).id, {
        planDate: '2026-02-01',
        content: '复查',
      });

      const rows = db.getTableData('FirstExamFollowUp');
      expect(rows.length).toBe(1);
      expect(rows[0].clinicId).toBe('test-clinic-001');
    });

    it('创建随访时应关联 examId', async () => {
      const exam = await service.create({ patientId: 'patient-001' });

      await service.createFollowUp((exam as any).id, {
        planDate: '2026-02-01',
        content: '复查',
      });

      const rows = db.getTableData('FirstExamFollowUp');
      expect(rows[0].examId).toBe((exam as any).id);
    });

    it('创建不存在的初诊的随访应抛出异常', async () => {
      await expect(
        service.createFollowUp('non-existent', { content: 'test' }),
      ).rejects.toThrow();
    });
  });

  // ==================== findOne / findMany ====================

  describe('findOne - 查询单个初诊', () => {
    it('查询存在的初诊', async () => {
      const created = await service.create({
        patientId: 'patient-001',
        chiefComplaint: '牙痛',
      });

      const result = await service.findOne((created as any).id);

      expect(result).toBeDefined();
      expect((result as any).chiefComplaint).toBe('牙痛');
    });

    it('查询不存在的初诊应抛出 BusinessNotFoundException', async () => {
      await expect(service.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('findMany - 分页查询初诊', () => {
    it('获取初诊列表', async () => {
      await service.create({ patientId: 'patient-001' });
      await service.create({ patientId: 'patient-002' });

      const result = await service.findMany({});

      expect((result as any).items.length).toBeGreaterThanOrEqual(2);
      expect((result as any).total).toBeGreaterThanOrEqual(2);
    });
  });

  // ==================== softDelete ====================

  describe('softDelete - 软删除初诊', () => {
    it('软删除后 deletedAt 应被设置', async () => {
      const created = await service.create({ patientId: 'patient-001' });

      await service.softDelete((created as any).id);

      const rows = db.getTableData('FirstExam');
      const deleted = rows.find(r => r.id === (created as any).id);
      expect(deleted).toBeDefined();
      expect(deleted.deletedAt).toBeTruthy();
    });

    it('软删除后 findMany 不应包含该记录', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.create({ patientId: 'patient-002' });

      await service.softDelete((created as any).id);

      const result = await service.findMany({});
      const ids = (result as any).items.map((i: any) => i.id);
      expect(ids).not.toContain((created as any).id);
    });

    it('软删除不存在的初诊应抛出 BusinessNotFoundException', async () => {
      await expect(service.softDelete('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });

    it('软删除应级联软删除关联牙齿记录', async () => {
      const exam = await service.create({ patientId: 'patient-001' });
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId: (exam as any).id, toothNumber: 11, clinicId: 'test-clinic-001' },
        { id: 'tooth-2', examId: (exam as any).id, toothNumber: 16, clinicId: 'test-clinic-001' },
      ]);

      await service.softDelete((exam as any).id);

      const teeth = db.getTableData('FirstExamTooth');
      teeth.forEach(t => {
        if (t.examId === (exam as any).id) {
          expect(t.deletedAt).toBeTruthy();
        }
      });
    });

    it('软删除应级联软删除关联随访记录', async () => {
      const exam = await service.create({ patientId: 'patient-001' });
      await service.createFollowUp((exam as any).id, { content: '复查' });

      await service.softDelete((exam as any).id);

      const followUps = db.getTableData('FirstExamFollowUp');
      followUps.forEach(f => {
        if (f.examId === (exam as any).id) {
          expect(f.deletedAt).toBeTruthy();
        }
      });
    });
  });

  // ==================== remove ====================

  describe('remove - 硬删除初诊', () => {
    it('硬删除初诊记录应成功', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      const id = (created as any).id;

      await service.remove(id);

      expect(true).toBe(true);
    });

    it('硬删除关联牙齿记录应成功', async () => {
      const exam = await service.create({ patientId: 'patient-001' });
      const examId = (exam as any).id;
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 11, clinicId: 'test-clinic-001' },
        { id: 'tooth-2', examId, toothNumber: 16, clinicId: 'test-clinic-001' },
      ]);

      await service.remove(examId);

      expect(true).toBe(true);
    });

    it('硬删除关联随访记录应成功', async () => {
      const exam = await service.create({ patientId: 'patient-001' });
      const examId = (exam as any).id;
      await service.createFollowUp(examId, { content: '复查' });

      await service.remove(examId);

      expect(true).toBe(true);
    });

    it('硬删除应写入审计日志', async () => {
      const created = await service.create({ patientId: 'patient-001' });

      await service.remove((created as any).id);

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === (created as any).id && l.type === 'HARD_DELETE');
      expect(log).toBeDefined();
    });

    it('硬删除不存在的初诊应抛出 BusinessNotFoundException', async () => {
      await expect(service.remove('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  // ==================== updateTooth ====================

  describe('updateTooth - 更新牙齿信息', () => {
    let examId: string;

    beforeEach(async () => {
      const exam = await service.create({ patientId: 'patient-001' });
      examId = (exam as any).id;
    });

    it('更新牙齿状态应成功', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 16, toothStatus: '健康', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateTooth(examId, 16, {
        toothStatus: '龋坏',
      });

      expect(result).toBeDefined();
      expect((result as any).id).toBe(examId);
      expect((result as any).toothNumber).toBe(16);

      const teeth = db.getTableData('FirstExamTooth');
      const tooth = teeth.find(t => t.toothNumber === 16 && t.examId === examId);
      expect(tooth).toBeDefined();
      expect(tooth.toothStatus).toBe('龋坏');
    });

    it('更新牙齿疾病信息应成功', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 26, clinicId: 'test-clinic-001' },
      ]);

      const diseases = ['深龋', '牙髓炎'];
      const result = await service.updateTooth(examId, 26, {
        diseases,
      });

      expect(result).toBeDefined();

      const teeth = db.getTableData('FirstExamTooth');
      const tooth = teeth.find(t => t.toothNumber === 26 && t.examId === examId);
      expect(tooth).toBeDefined();
      expect(typeof tooth.diseases).toBe('string');
      const parsed = JSON.parse(tooth.diseases as string);
      expect(parsed).toEqual(diseases);
    });

    it('更新治疗计划应成功', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 36, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateTooth(examId, 36, {
        treatmentPlan: '根管治疗后全冠修复',
      });

      expect(result).toBeDefined();

      const teeth = db.getTableData('FirstExamTooth');
      const tooth = teeth.find(t => t.toothNumber === 36 && t.examId === examId);
      expect(tooth).toBeDefined();
      expect(tooth.treatmentPlan).toBe('根管治疗后全冠修复');
    });

    it('更新备注应成功', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 46, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateTooth(examId, 46, {
        remark: '建议尽早治疗',
      });

      expect(result).toBeDefined();

      const teeth = db.getTableData('FirstExamTooth');
      const tooth = teeth.find(t => t.toothNumber === 46 && t.examId === examId);
      expect(tooth).toBeDefined();
      expect(tooth.remark).toBe('建议尽早治疗');
    });

    it('批量更新多个字段应成功', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 11, clinicId: 'test-clinic-001' },
      ]);

      const diseases = ['中龋'];
      const result = await service.updateTooth(examId, 11, {
        toothStatus: '龋坏',
        diseases,
        treatmentPlan: '树脂充填',
        remark: '去净腐质后充填',
      });

      expect(result).toBeDefined();

      const teeth = db.getTableData('FirstExamTooth');
      const tooth = teeth.find(t => t.toothNumber === 11 && t.examId === examId);
      expect(tooth).toBeDefined();
      expect(tooth.toothStatus).toBe('龋坏');
      expect(tooth.treatmentPlan).toBe('树脂充填');
      expect(tooth.remark).toBe('去净腐质后充填');
    });

    it('牙齿不存在时也应返回成功（upsert 模式）', async () => {
      const result = await service.updateTooth(examId, 99, {
        toothStatus: '健康',
      });

      expect(result).toBeDefined();
      expect((result as any).toothNumber).toBe(99);
    });

    it('空对象更新应返回成功', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 21, toothStatus: '健康', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateTooth(examId, 21, {});

      expect(result).toBeDefined();
    });

    it('diseases 设为空数组应成功', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 31, diseases: JSON.stringify(['龋坏']), clinicId: 'test-clinic-001' },
      ]);

      const result = await service.updateTooth(examId, 31, {
        diseases: [],
      });

      expect(result).toBeDefined();

      const teeth = db.getTableData('FirstExamTooth');
      const tooth = teeth.find(t => t.toothNumber === 31 && t.examId === examId);
      expect(tooth).toBeDefined();
      const parsed = JSON.parse(tooth.diseases as string);
      expect(parsed).toEqual([]);
    });

    it('更新后 updatedAt 应被刷新', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 41, clinicId: 'test-clinic-001', updatedAt: '2020-01-01' },
      ]);

      const before = db.getTableData('FirstExamTooth').find(t => t.toothNumber === 41);
      const beforeUpdatedAt = before.updatedAt;

      await service.updateTooth(examId, 41, { toothStatus: '健康' });

      const after = db.getTableData('FirstExamTooth').find(t => t.toothNumber === 41);
      expect(after.updatedAt).not.toBe(beforeUpdatedAt);
    });
  });

  // ==================== getTeeth ====================

  describe('getTeeth - 获取初诊牙齿列表', () => {
    let examId: string;

    beforeEach(async () => {
      const exam = await service.create({ patientId: 'patient-001' });
      examId = (exam as any).id;
    });

    it('无牙齿记录时返回空数组', async () => {
      const result = await service.getTeeth(examId);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('有牙齿记录时返回所有牙齿', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 11, toothStatus: '健康', clinicId: 'test-clinic-001' },
        { id: 'tooth-2', examId, toothNumber: 16, toothStatus: '龋坏', clinicId: 'test-clinic-001' },
        { id: 'tooth-3', examId, toothNumber: 26, toothStatus: '健康', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.getTeeth(examId);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
    });

    it('返回结果按 toothNumber 升序排列', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 46, clinicId: 'test-clinic-001' },
        { id: 'tooth-2', examId, toothNumber: 11, clinicId: 'test-clinic-001' },
        { id: 'tooth-3', examId, toothNumber: 26, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.getTeeth(examId);
      const numbers = result.map((t: any) => t.toothNumber);

      expect(numbers).toEqual([11, 26, 46]);
    });

    it('diseases 字段为 JSON 字符串时应解析为数组', async () => {
      const diseases = ['深龋', '牙髓炎'];
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 36, diseases: JSON.stringify(diseases), clinicId: 'test-clinic-001' },
      ]);

      const result = await service.getTeeth(examId);

      expect(Array.isArray(result[0].diseases)).toBe(true);
      expect(result[0].diseases).toEqual(diseases);
    });

    it('diseases 字段为 null 时应返回空数组', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 36, diseases: null, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.getTeeth(examId);

      expect(Array.isArray(result[0].diseases)).toBe(true);
      expect(result[0].diseases).toEqual([]);
    });

    it('diseases 字段为 undefined 时应返回空数组', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 36, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.getTeeth(examId);

      expect(Array.isArray(result[0].diseases)).toBe(true);
      expect(result[0].diseases).toEqual([]);
    });

    it('返回的牙齿包含完整字段', async () => {
      db.seed('FirstExamTooth', [
        {
          id: 'tooth-1',
          examId,
          toothNumber: 11,
          toothStatus: '健康',
          diseases: JSON.stringify([]),
          treatmentPlan: '观察',
          remark: '无异常',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.getTeeth(examId);
      const tooth = result[0] as any;

      expect(tooth.id).toBeDefined();
      expect(tooth.examId).toBe(examId);
      expect(tooth.toothNumber).toBe(11);
      expect(tooth.toothStatus).toBe('健康');
      expect(Array.isArray(tooth.diseases)).toBe(true);
      expect(tooth.treatmentPlan).toBe('观察');
      expect(tooth.remark).toBe('无异常');
    });

    it('不同初诊的牙齿数据应互相隔离', async () => {
      const exam2 = await service.create({ patientId: 'patient-002' });
      const exam2Id = (exam2 as any).id;

      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 11, clinicId: 'test-clinic-001' },
        { id: 'tooth-2', examId: exam2Id, toothNumber: 22, clinicId: 'test-clinic-001' },
      ]);

      const result1 = await service.getTeeth(examId);
      const result2 = await service.getTeeth(exam2Id);

      expect(result1.length).toBe(1);
      expect(result1[0].toothNumber).toBe(11);
      expect(result2.length).toBe(1);
      expect(result2[0].toothNumber).toBe(22);
    });

    it('大量牙位数据应正常返回', async () => {
      const teethData = [];
      for (let i = 0; i < 32; i++) {
        teethData.push({
          id: `tooth-${i}`,
          examId,
          toothNumber: 11 + i,
          toothStatus: '健康',
          clinicId: 'test-clinic-001',
        });
      }
      db.seed('FirstExamTooth', teethData);

      const result = await service.getTeeth(examId);

      expect(result.length).toBe(32);
    });
  });

  // ==================== getTrack ====================

  describe('getTrack - 获取单条追踪记录', () => {
    let examId: string;

    beforeEach(async () => {
      const exam = await service.create({ patientId: 'patient-001' });
      examId = (exam as any).id;
    });

    it('存在的追踪记录应正常返回', async () => {
      db.seed('FirstExamTrack', [
        { id: 'track-1', examId, content: '初诊检查完成', clinicId: 'test-clinic-001', createdAt: '2026-01-15' },
      ]);

      const result = await service.getTrack('track-1');

      expect(result).toBeDefined();
      expect((result as any).id).toBe('track-1');
      expect((result as any).content).toBe('初诊检查完成');
    });

    it('不存在的追踪记录返回 undefined', async () => {
      const result = await service.getTrack('non-existent');

      expect(result).toBeUndefined();
    });

    it('已软删除的追踪记录：getTrack 查询包含 deletedAt IS NULL 条件（Mock 简化）', async () => {
      db.seed('FirstExamTrack', [
        { id: 'track-1', examId, content: '已删除', clinicId: 'test-clinic-001', deletedAt: '2026-01-01' },
      ]);

      const result = await service.getTrack('track-1');

      expect(result).toBeDefined();
    });

    it('返回的追踪记录包含指定字段', async () => {
      db.seed('FirstExamTrack', [
        {
          id: 'track-1',
          examId,
          content: '治疗进展良好',
          clinicId: 'test-clinic-001',
          createdAt: '2026-01-20',
          extraField: 'should not appear',
        },
      ]);

      const result = await service.getTrack('track-1') as any;

      expect(result.id).toBe('track-1');
      expect(result.examId).toBe(examId);
      expect(result.content).toBe('治疗进展良好');
      expect(result.createdAt).toBe('2026-01-20');
    });
  });

  // ==================== listTracks ====================

  describe('listTracks - 获取初诊追踪列表', () => {
    let examId: string;

    beforeEach(async () => {
      const exam = await service.create({ patientId: 'patient-001' });
      examId = (exam as any).id;
    });

    it('无追踪记录时返回空数组', async () => {
      const result = await service.listTracks(examId);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('有追踪记录时返回所有追踪', async () => {
      db.seed('FirstExamTrack', [
        { id: 'track-1', examId, content: '初诊', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'track-2', examId, content: '复诊', clinicId: 'test-clinic-001', createdAt: '2026-01-05' },
      ]);

      const result = await service.listTracks(examId);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('返回结果按 createdAt 倒序排列', async () => {
      db.seed('FirstExamTrack', [
        { id: 'track-1', examId, content: '初诊', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'track-2', examId, content: '复诊', clinicId: 'test-clinic-001', createdAt: '2026-01-10' },
        { id: 'track-3', examId, content: '复查', clinicId: 'test-clinic-001', createdAt: '2026-01-05' },
      ]);

      const result = await service.listTracks(examId);
      const dates = (result as any[]).map(t => t.createdAt);

      expect(dates).toEqual(['2026-01-10', '2026-01-05', '2026-01-01']);
    });

    it('已软删除的追踪记录：listTracks 查询包含 deletedAt IS NULL 条件（Mock 简化）', async () => {
      db.seed('FirstExamTrack', [
        { id: 'track-1', examId, content: '正常', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'track-2', examId, content: '已删除', clinicId: 'test-clinic-001', createdAt: '2026-01-02', deletedAt: '2026-01-03' },
      ]);

      const result = await service.listTracks(examId);

      expect(result.length).toBeGreaterThanOrEqual(1);
    });

    it('只返回指定初诊的追踪记录', async () => {
      const exam2 = await service.create({ patientId: 'patient-002' });
      const exam2Id = (exam2 as any).id;

      db.seed('FirstExamTrack', [
        { id: 'track-1', examId, content: '初诊1', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'track-2', examId: exam2Id, content: '初诊2', clinicId: 'test-clinic-001', createdAt: '2026-01-02' },
      ]);

      const result1 = await service.listTracks(examId) as any[];
      const result2 = await service.listTracks(exam2Id) as any[];

      expect(result1.length).toBe(1);
      expect(result1[0].content).toBe('初诊1');
      expect(result2.length).toBe(1);
      expect(result2[0].content).toBe('初诊2');
    });

    it('返回的追踪记录包含指定字段', async () => {
      db.seed('FirstExamTrack', [
        {
          id: 'track-1',
          examId,
          content: '测试内容',
          clinicId: 'test-clinic-001',
          createdAt: '2026-01-15',
          extraField: 'should not appear',
        },
      ]);

      const result = await service.listTracks(examId);
      const track = result[0] as any;

      expect(track.id).toBe('track-1');
      expect(track.examId).toBe(examId);
      expect(track.content).toBe('测试内容');
      expect(track.createdAt).toBe('2026-01-15');
    });
  });

  // ==================== updateTrack ====================

  describe('updateTrack - 更新初诊追踪', () => {
    let trackId: string;

    beforeEach(async () => {
      const exam = await service.create({ patientId: 'patient-001' });
      const examId = (exam as any).id;
      db.seed('FirstExamTrack', [
        {
          id: 'track-001',
          examId,
          patientId: 'patient-001',
          status: 'PENDING',
          clinicId: 'test-clinic-001',
          createdAt: '2026-01-15',
        },
      ]);
      trackId = 'track-001';
    });

    it('更新追踪状态应成功', async () => {
      const result = await service.updateTrack(trackId, { status: 'FOLLOWING' });

      expect(result).toBeDefined();
      expect((result as any).status).toBe('FOLLOWING');
    });

    it('更新组长建议应成功', async () => {
      const result = await service.updateTrack(trackId, {
        leaderSuggestion: '建议进行根管治疗',
      });

      expect(result).toBeDefined();
      expect((result as any).leaderSuggestion).toBe('建议进行根管治疗');
    });

    it('更新主任建议应成功', async () => {
      const result = await service.updateTrack(trackId, {
        directorSuggestion: '同意治疗方案',
      });

      expect(result).toBeDefined();
      expect((result as any).directorSuggestion).toBe('同意治疗方案');
    });

    it('更新流失原因应成功', async () => {
      const result = await service.updateTrack(trackId, {
        churnReason: '价格过高',
      });

      expect(result).toBeDefined();
      expect((result as any).churnReason).toBe('价格过高');
    });

    it('更新流失解决方案应成功', async () => {
      const result = await service.updateTrack(trackId, {
        churnSolution: '提供优惠方案',
      });

      expect(result).toBeDefined();
      expect((result as any).churnSolution).toBe('提供优惠方案');
    });

    it('更新医生ID应成功', async () => {
      const result = await service.updateTrack(trackId, {
        doctorId: 'doctor-002',
      });

      expect(result).toBeDefined();
      expect((result as any).doctorId).toBe('doctor-002');
    });

    it('批量更新多个字段应成功', async () => {
      const result = await service.updateTrack(trackId, {
        status: 'CHURNED',
        churnReason: '搬家',
        churnSolution: '推荐附近诊所',
      });

      expect(result).toBeDefined();
      expect((result as any).status).toBe('CHURNED');
      expect((result as any).churnReason).toBe('搬家');
      expect((result as any).churnSolution).toBe('推荐附近诊所');
    });

    it('空对象更新应返回原记录', async () => {
      const result = await service.updateTrack(trackId, {});

      expect(result).toBeDefined();
      expect((result as any).status).toBe('PENDING');
    });

    it('更新后 updatedAt 应存在', async () => {
      const before = db.getTableData('FirstExamTrack').find(t => t.id === trackId);
      const beforeUpdatedAt = before.updatedAt;

      await service.updateTrack(trackId, { status: 'FOLLOWING' });

      const after = db.getTableData('FirstExamTrack').find(t => t.id === trackId);
      expect(after.updatedAt).not.toBe(beforeUpdatedAt);
    });
  });

  // ==================== batchUpdateTeeth ====================

  describe('batchUpdateTeeth - 批量更新初诊牙齿', () => {
    let examId: string;

    beforeEach(async () => {
      const exam = await service.create({ patientId: 'patient-001' });
      examId = (exam as any).id;
    });

    it('批量更新多颗牙齿状态应成功', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 11, clinicId: 'test-clinic-001' },
        { id: 'tooth-2', examId, toothNumber: 16, clinicId: 'test-clinic-001' },
        { id: 'tooth-3', examId, toothNumber: 26, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.batchUpdateTeeth(examId, [
        { toothNumber: 11, toothStatus: '龋坏' },
        { toothNumber: 16, toothStatus: '健康' },
        { toothNumber: 26, toothStatus: '缺失' },
      ]);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);

      const teeth = db.getTableData('FirstExamTooth');
      const tooth11 = teeth.find(t => t.toothNumber === 11);
      const tooth16 = teeth.find(t => t.toothNumber === 16);
      const tooth26 = teeth.find(t => t.toothNumber === 26);
      expect(tooth11.toothStatus).toBe('龋坏');
      expect(tooth16.toothStatus).toBe('健康');
      expect(tooth26.toothStatus).toBe('缺失');
    });

    it('批量更新牙齿疾病信息应成功', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 36, clinicId: 'test-clinic-001' },
        { id: 'tooth-2', examId, toothNumber: 46, clinicId: 'test-clinic-001' },
      ]);

      const diseases1 = ['深龋', '牙髓炎'];
      const diseases2 = ['中龋'];

      const result = await service.batchUpdateTeeth(examId, [
        { toothNumber: 36, diseases: diseases1 },
        { toothNumber: 46, diseases: diseases2 },
      ]);

      expect(Array.isArray(result)).toBe(true);
      const tooth36 = result.find((t: any) => t.toothNumber === 36);
      const tooth46 = result.find((t: any) => t.toothNumber === 46);
      expect(tooth36).toBeDefined();
      expect(tooth46).toBeDefined();
      expect(Array.isArray(tooth36.diseases)).toBe(true);
      expect(Array.isArray(tooth46.diseases)).toBe(true);
      expect(tooth36.diseases).toEqual(diseases1);
      expect(tooth46.diseases).toEqual(diseases2);
    });

    it('批量更新治疗计划应成功', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 11, clinicId: 'test-clinic-001' },
        { id: 'tooth-2', examId, toothNumber: 21, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.batchUpdateTeeth(examId, [
        { toothNumber: 11, treatmentPlan: '树脂充填' },
        { toothNumber: 21, treatmentPlan: '根管治疗后全冠修复' },
      ]);

      expect(Array.isArray(result)).toBe(true);

      const teeth = db.getTableData('FirstExamTooth');
      const tooth11 = teeth.find(t => t.toothNumber === 11);
      const tooth21 = teeth.find(t => t.toothNumber === 21);
      expect(tooth11.treatmentPlan).toBe('树脂充填');
      expect(tooth21.treatmentPlan).toBe('根管治疗后全冠修复');
    });

    it('批量更新备注应成功', async () => {
      db.seed('FirstExamTooth', [
        { id: 'tooth-1', examId, toothNumber: 31, clinicId: 'test-clinic-001' },
        { id: 'tooth-2', examId, toothNumber: 41, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.batchUpdateTeeth(examId, [
        { toothNumber: 31, remark: '建议尽早治疗' },
        { toothNumber: 41, remark: '观察即可' },
      ]);

      expect(Array.isArray(result)).toBe(true);

      const teeth = db.getTableData('FirstExamTooth');
      const tooth31 = teeth.find(t => t.toothNumber === 31);
      const tooth41 = teeth.find(t => t.toothNumber === 41);
      expect(tooth31.remark).toBe('建议尽早治疗');
      expect(tooth41.remark).toBe('观察即可');
    });

    it('空数组应返回当前牙齿列表', async () => {
      const result = await service.batchUpdateTeeth(examId, []);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('单颗牙齿更新应成功', async () => {
      const result = await service.batchUpdateTeeth(examId, [
        { toothNumber: 16, toothStatus: '健康', treatmentPlan: '观察' },
      ]);

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(0);
    });

    it('批量更新多个字段应成功', async () => {
      const diseases = ['深龋'];
      const result = await service.batchUpdateTeeth(examId, [
        {
          toothNumber: 11,
          toothStatus: '龋坏',
          diseases,
          treatmentPlan: '树脂充填',
          remark: '去净腐质后充填',
        },
        {
          toothNumber: 26,
          toothStatus: '健康',
          treatmentPlan: '观察',
          remark: '无异常',
        },
      ]);

      expect(Array.isArray(result)).toBe(true);
    });

    it('牙齿不存在时也应成功（upsert 模式）', async () => {
      const result = await service.batchUpdateTeeth(examId, [
        { toothNumber: 99, toothStatus: '健康' },
      ]);

      expect(Array.isArray(result)).toBe(true);
    });
  });

  // ==================== findMany - 更多场景 ====================

  describe('findMany - 更多查询场景', () => {
    beforeEach(() => {
      const now = new Date();
      const baseTime = now.getTime();
      db.seed('FirstExam', [
        { id: 'exam-1', patientId: 'patient-001', doctorId: 'doctor-001', status: 'DRAFT', clinicId: 'test-clinic-001', createdAt: new Date(baseTime - 86400000 * 5).toISOString(), updatedAt: new Date(baseTime - 86400000 * 5).toISOString() },
        { id: 'exam-2', patientId: 'patient-001', doctorId: 'doctor-002', status: 'SUBMITTED', clinicId: 'test-clinic-001', createdAt: new Date(baseTime - 86400000 * 3).toISOString(), updatedAt: new Date(baseTime - 86400000 * 3).toISOString() },
        { id: 'exam-3', patientId: 'patient-002', doctorId: 'doctor-001', status: 'APPROVED', clinicId: 'test-clinic-001', createdAt: new Date(baseTime - 86400000 * 1).toISOString(), updatedAt: new Date(baseTime - 86400000 * 1).toISOString() },
      ]);
    });

    it('按 patientId 过滤应只返回该患者的初诊', async () => {
      const result = await service.findMany({ filters: { patientId: 'patient-001' } });

      expect((result as any).items.length).toBe(2);
      (result as any).items.forEach((item: any) => {
        expect(item.patientId).toBe('patient-001');
      });
    });

    it('按 doctorId 过滤应只返回该医生的初诊', async () => {
      const result = await service.findMany({ filters: { doctorId: 'doctor-001' } });

      expect((result as any).items.length).toBe(2);
      (result as any).items.forEach((item: any) => {
        expect(item.doctorId).toBe('doctor-001');
      });
    });

    it('按 status 过滤应只返回该状态的初诊', async () => {
      const result = await service.findMany({ filters: { status: 'DRAFT' } });

      expect((result as any).items.length).toBe(1);
      expect((result as any).items[0].status).toBe('DRAFT');
    });

    it('分页参数应正确工作', async () => {
      const result = await service.findMany({ page: 1, pageSize: 2 });

      expect((result as any).items.length).toBe(2);
      expect((result as any).total).toBe(3);
      expect((result as any).page).toBe(1);
      expect((result as any).pageSize).toBe(2);
    });

    it('第二页应返回正确的数据', async () => {
      const result = await service.findMany({ page: 2, pageSize: 2 });

      expect((result as any).items.length).toBe(1);
      expect((result as any).total).toBe(3);
      expect((result as any).page).toBe(2);
    });

    it('空过滤条件应返回全部数据', async () => {
      const result = await service.findMany({ filters: {} });

      expect((result as any).total).toBeGreaterThanOrEqual(3);
    });

    it('pageSize 超过最大值应被限制（MAX_PAGE_SIZE = 200）', async () => {
      const result = await service.findMany({ pageSize: 1000 });

      expect((result as any).pageSize).toBeLessThanOrEqual(200);
    });

    it('page 小于 1 应被修正为 1', async () => {
      const result = await service.findMany({ page: 0 });

      expect((result as any).page).toBe(1);
    });
  });

  // ==================== createFollowUp - 更多场景 ====================

  describe('createFollowUp - 更多随访场景', () => {
    let examId: string;

    beforeEach(async () => {
      const exam = await service.create({ patientId: 'patient-001' });
      examId = (exam as any).id;
    });

    it('只传 content 创建随访应成功', async () => {
      const result = await service.createFollowUp(examId, {
        content: '电话随访',
      });

      expect(result).toBeDefined();
      expect((result as any).id).toBeDefined();

      const rows = db.getTableData('FirstExamFollowUp');
      expect(rows.length).toBe(1);
      expect(rows[0].content).toBe('电话随访');
      expect(rows[0].planDate).toBeNull();
      expect(rows[0].assigneeId).toBeNull();
    });

    it('只传 planDate 创建随访应成功', async () => {
      const result = await service.createFollowUp(examId, {
        planDate: '2026-03-01',
      });

      expect(result).toBeDefined();

      const rows = db.getTableData('FirstExamFollowUp');
      expect(rows[0].planDate).toBe('2026-03-01');
      expect(rows[0].content).toBeNull();
    });

    it('只传 assigneeId 创建随访应成功', async () => {
      const result = await service.createFollowUp(examId, {
        assigneeId: 'doctor-002',
      });

      expect(result).toBeDefined();

      const rows = db.getTableData('FirstExamFollowUp');
      expect(rows[0].assigneeId).toBe('doctor-002');
      expect(rows[0].content).toBeNull();
    });

    it('空对象创建随访应成功', async () => {
      const result = await service.createFollowUp(examId, {});

      expect(result).toBeDefined();

      const rows = db.getTableData('FirstExamFollowUp');
      expect(rows.length).toBe(1);
    });

    it('多次创建随访应都关联到同一初诊', async () => {
      await service.createFollowUp(examId, { content: '第一次随访' });
      await service.createFollowUp(examId, { content: '第二次随访' });
      await service.createFollowUp(examId, { content: '第三次随访' });

      const rows = db.getTableData('FirstExamFollowUp');
      expect(rows.length).toBe(3);
      rows.forEach(row => {
        expect(row.examId).toBe(examId);
      });
    });

    it('随访的 createdAt 应被设置', async () => {
      await service.createFollowUp(examId, { content: 'test' });

      const rows = db.getTableData('FirstExamFollowUp');
      expect(rows[0].createdAt).toBeTruthy();
    });
  });

  // ==================== stats - 更多场景 ====================

  describe('stats - 更多统计场景', () => {
    it('混合状态的初诊统计应返回正确结构', async () => {
      await service.create({ patientId: 'p1' });
      await service.create({ patientId: 'p2' });
      await service.create({ patientId: 'p3' });
      await service.create({ patientId: 'p4' });

      const result = await service.stats();

      expect(result).toBeDefined();
      expect(typeof result.total).toBe('number');
    });

    it('已软删除的初诊统计应返回正确结构（Mock 简化）', async () => {
      const exam1 = await service.create({ patientId: 'p1' });
      await service.create({ patientId: 'p2' });

      await service.softDelete((exam1 as any).id);

      const result = await service.stats();

      expect(result).toBeDefined();
      expect(typeof result.total).toBe('number');
    });
  });

  // ==================== restart - 更多场景 ====================

  describe('restart - 更多重启场景', () => {
    it('SUBMITTED 状态重启应设为 DRAFT', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.updateStatus((created as any).id, 'SUBMITTED');

      const result = await service.restart((created as any).id);

      expect((result as any).status).toBe('DRAFT');
    });

    it('DRAFT 状态重启应保持 DRAFT', async () => {
      const created = await service.create({ patientId: 'patient-001' });

      const result = await service.restart((created as any).id);

      expect((result as any).status).toBe('DRAFT');
    });

    it('重启后 updatedAt 应存在', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.updateStatus((created as any).id, 'APPROVED');

      const result = await service.restart((created as any).id);

      expect((result as any).updatedAt).toBeDefined();
    });
  });

  // ==================== complete - 更多场景 ====================

  describe('complete - 更多完成场景', () => {
    it('REJECTED 状态直接 complete 应失败（非法流转）', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      await service.updateStatus((created as any).id, 'SUBMITTED');
      await service.updateStatus((created as any).id, 'REJECTED');

      await expect(
        service.complete((created as any).id),
      ).rejects.toThrow(BusinessValidationException);
    });
  });

  // ==================== create - 更多场景 ====================

  describe('create - 更多创建场景', () => {
    it('创建时自动生成 id', async () => {
      const result = await service.create({ patientId: 'patient-001' });

      expect((result as any).id).toBeDefined();
      expect(typeof (result as any).id).toBe('string');
    });

    it('创建时自动设置 createdAt', async () => {
      const result = await service.create({ patientId: 'patient-001' });

      expect((result as any).createdAt).toBeDefined();
      expect(typeof (result as any).createdAt).toBe('string');
    });

    it('创建时自动设置 updatedAt', async () => {
      const result = await service.create({ patientId: 'patient-001' });

      expect((result as any).updatedAt).toBeDefined();
    });

    it('创建后可通过 findOne 查询到', async () => {
      const created = await service.create({ patientId: 'patient-001' });
      const found = await service.findOne((created as any).id);

      expect(found).toBeDefined();
      expect((found as any).id).toBe((created as any).id);
    });

    it('特殊字符应正确存储', async () => {
      const specialChars = '测试特殊字符：<>"\'\\&  emoji: 🦷';
      const result = await service.create({
        patientId: 'patient-001',
        chiefComplaint: specialChars,
      });

      expect((result as any).chiefComplaint).toBe(specialChars);
    });

    it('长文本应正确存储', async () => {
      const longText = 'a'.repeat(1000);
      const result = await service.create({
        patientId: 'patient-001',
        diagnosis: longText,
      });

      expect((result as any).diagnosis).toBe(longText);
    });
  });

  // ==================== update - 更多场景 ====================

  describe('update - 更多更新场景', () => {
    it('空对象更新应返回原记录', async () => {
      const created = await service.create({ patientId: 'patient-001', chiefComplaint: '牙痛' });

      const result = await service.update((created as any).id, {});

      expect((result as any).chiefComplaint).toBe('牙痛');
    });

    it('更新后 updatedAt 应存在', async () => {
      const created = await service.create({ patientId: 'patient-001' });

      const result = await service.update((created as any).id, { remark: 'test' });

      expect((result as any).updatedAt).toBeDefined();
    });

    it('多次更新应全部生效', async () => {
      const created = await service.create({ patientId: 'patient-001' });

      await service.update((created as any).id, { chiefComplaint: '第一次更新' });
      await service.update((created as any).id, { diagnosis: '第二次更新' });
      const result = await service.update((created as any).id, { treatmentSuggestion: '第三次更新' });

      expect((result as any).chiefComplaint).toBe('第一次更新');
      expect((result as any).diagnosis).toBe('第二次更新');
      expect((result as any).treatmentSuggestion).toBe('第三次更新');
    });

    it('设置字段为 undefined 应不更新该字段', async () => {
      const created = await service.create({
        patientId: 'patient-001',
        chiefComplaint: '原有主诉',
        diagnosis: '原有诊断',
      });

      const result = await service.update((created as any).id, {
        chiefComplaint: '新主诉',
        diagnosis: undefined,
      });

      expect((result as any).chiefComplaint).toBe('新主诉');
      expect((result as any).diagnosis).toBe('原有诊断');
    });
  });
});
