import { MedicalRecordsService } from './medical-records.service';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { CacheService } from '../../../common/services/cache.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

function createMockClinicContext(): ClinicContextService {
  return {
    getClinicId: () => 'test-clinic-001',
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

// P4-3: MedicalRecordsService 现在依赖 CacheService，构造一个始终 miss 的 mock
function createMockCacheService(): CacheService {
  return {
    get: jest.fn().mockReturnValue(undefined),
    set: jest.fn(),
    del: jest.fn(),
    delPattern: jest.fn(),
    clear: jest.fn(),
    getOrSet: jest.fn(),
    getStats: () => ({ hits: 0, misses: 0, hitRate: 0, size: 0, maxSize: 1000 }),
    resetStats: jest.fn(),
  } as unknown as CacheService;
}

describe('MedicalRecordsService', () => {
  let service: MedicalRecordsService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new MedicalRecordsService(db as any, createMockClinicContext(), createMockCacheService());
  });

  afterEach(() => {
    db.clear();
  });

  describe('create - 创建病历', () => {
    it('正常创建病历', async () => {
      const dto = {
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        chiefComplaint: '牙痛',
        presentIllness: '左下后牙疼痛3天',
        diagnosis: '牙髓炎',
        treatmentPlan: '根管治疗',
      };

      const result = await service.create(dto);

      expect(result).toBeDefined();
      expect((result as any).patientId).toBe('patient-001');
      expect((result as any).chiefComplaint).toBe('牙痛');
      expect(Boolean((result as any).isLocked)).toBe(false);
    });

    it('创建病历带牙齿和图片信息', async () => {
      const dto = {
        patientId: 'patient-002',
        doctorId: 'doctor-001',
        chiefComplaint: '补牙',
        teethInvolved: ['16', '26'],
        images: ['img1.jpg', 'img2.jpg'],
      };

      const result = await service.create(dto);

      expect(result).toBeDefined();
      expect((result as any).patientId).toBe('patient-002');
    });

    it('创建病历使用默认值', async () => {
      const dto = {
        patientId: 'patient-003',
        doctorId: 'doctor-001',
      };

      const result = await service.create(dto);

      expect(result).toBeDefined();
      expect((result as any).patientId).toBe('patient-003');
    });
  });

  describe('update - 修改病历', () => {
    it('未锁定的病历可以正常修改', async () => {
      db.seed('MedicalRecord', [
        {
          id: 'record-001',
          patientId: 'p1',
          doctorId: 'd1',
          chiefComplaint: '初始主诉',
          diagnosis: '初始诊断',
          isLocked: 0,
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('record-001', {
        chiefComplaint: '更新后的主诉',
        diagnosis: '更新后的诊断',
      });

      expect((result as any).chiefComplaint).toBe('更新后的主诉');
      expect((result as any).diagnosis).toBe('更新后的诊断');
    });

    it('已锁定的病历不能直接修改，应抛出 BadRequestException', async () => {
      db.seed('MedicalRecord', [
        {
          id: 'record-002',
          patientId: 'p1',
          doctorId: 'd1',
          chiefComplaint: '锁定病历',
          isLocked: 1,
          clinicId: 'test-clinic-001',
        },
      ]);

      await expect(
        service.update('record-002', { chiefComplaint: '尝试修改' } as any)
      ).rejects.toThrow(BadRequestException);
    });

    it('修改不存在的病历应抛出异常', async () => {
      await expect(
        service.update('non-existent', { chiefComplaint: 'test' } as any)
      ).rejects.toThrow();
    });
  });

  describe('lock - 锁定病历', () => {
    it('正常锁定病历', async () => {
      db.seed('MedicalRecord', [
        {
          id: 'record-001',
          patientId: 'p1',
          doctorId: 'd1',
          chiefComplaint: '待锁定',
          isLocked: 0,
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.lock('record-001', 'doctor-001');

      expect((result as any).isLocked).toBe(1);
      expect((result as any).lockedBy).toBe('doctor-001');
    });

    it('已锁定的病历重复锁定应抛出 BadRequestException', async () => {
      db.seed('MedicalRecord', [
        {
          id: 'record-002',
          patientId: 'p1',
          doctorId: 'd1',
          chiefComplaint: '已锁定',
          isLocked: 1,
          clinicId: 'test-clinic-001',
        },
      ]);

      await expect(service.lock('record-002', 'doctor-001')).rejects.toThrow(BadRequestException);
    });

    it('锁定不存在的病历应抛出异常', async () => {
      await expect(service.lock('non-existent', 'doctor-001')).rejects.toThrow();
    });
  });

  describe('createModifyRequest - 创建修改申请', () => {
    it('正常创建修改申请', async () => {
      db.seed('MedicalRecord', [
        {
          id: 'record-001',
          patientId: 'p1',
          doctorId: 'd1',
          chiefComplaint: '测试',
          isLocked: 1,
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.createModifyRequest(
        { recordId: 'record-001', reason: '需要补充病史' },
        'doctor-002'
      );

      expect(result).toBeDefined();
      expect((result as any).id).toBeDefined();

      const requests = db.getTableData('RecordModifyRequest');
      expect(requests.length).toBe(1);
      expect(requests[0].status).toBe('PENDING');
      expect(requests[0].reason).toBe('需要补充病史');
    });

    it('创建修改申请不带申请人，使用默认 userId', async () => {
      const result = await service.createModifyRequest(
        { recordId: 'record-001', reason: '测试原因' },
      );

      expect(result).toBeDefined();
    });
  });

  describe('reviewModifyRequest - 审批修改申请', () => {
    it('审批通过修改申请，解锁病历', async () => {
      db.seed('MedicalRecord', [
        {
          id: 'record-001',
          patientId: 'p1',
          doctorId: 'd1',
          chiefComplaint: '测试',
          isLocked: 1,
          clinicId: 'test-clinic-001',
        },
      ]);
      db.seed('RecordModifyRequest', [
        {
          id: 'req-001',
          recordId: 'record-001',
          applicantId: 'doctor-002',
          reason: '需要修改',
          status: 'PENDING',
          reviewerId: null,
          reviewRemark: null,
          reviewedAt: null,
          clinicId: 'test-clinic-001',
          createdAt: new Date().toISOString(),
        },
      ]);

      const result = await service.reviewModifyRequest(
        'req-001',
        { status: 'APPROVED', reviewRemark: '同意修改' },
        'reviewer-001'
      );

      expect(result).toBeDefined();
      expect((result as any).status).toBe('APPROVED');
      expect((result as any).reviewerId).toBe('reviewer-001');

      const records = db.getTableData('MedicalRecord');
      const updatedRecord = records.find(r => r.id === 'record-001');
      expect(updatedRecord?.isLocked).toBe(0);
    });

    it('审批拒绝修改申请，病历保持锁定', async () => {
      db.seed('MedicalRecord', [
        {
          id: 'record-002',
          patientId: 'p1',
          doctorId: 'd1',
          chiefComplaint: '测试',
          isLocked: 1,
          clinicId: 'test-clinic-001',
        },
      ]);
      db.seed('RecordModifyRequest', [
        {
          id: 'req-002',
          recordId: 'record-002',
          applicantId: 'doctor-002',
          reason: '需要修改',
          status: 'PENDING',
          reviewerId: null,
          reviewRemark: null,
          reviewedAt: null,
          clinicId: 'test-clinic-001',
          createdAt: new Date().toISOString(),
        },
      ]);

      const result = await service.reviewModifyRequest(
        'req-002',
        { status: 'REJECTED', reviewRemark: '理由不充分' },
        'reviewer-001'
      );

      expect(result).toBeDefined();
      expect((result as any).status).toBe('REJECTED');

      const records = db.getTableData('MedicalRecord');
      const updatedRecord = records.find(r => r.id === 'record-002');
      expect(updatedRecord?.isLocked).toBe(1);
    });

    it('审批不存在的申请应抛出 NotFoundException', async () => {
      await expect(
        service.reviewModifyRequest('non-existent', { status: 'APPROVED' }, 'reviewer-001')
      ).rejects.toThrow(NotFoundException);
    });

    it('审批状态非法应抛出 BadRequestException', async () => {
      db.seed('RecordModifyRequest', [
        {
          id: 'req-003',
          recordId: 'record-001',
          applicantId: 'd2',
          reason: 'test',
          status: 'PENDING',
          clinicId: 'test-clinic-001',
        },
      ]);

      await expect(
        service.reviewModifyRequest('req-003', { status: 'INVALID_STATUS' }, 'reviewer-001')
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('常用语管理', () => {
    it('创建常用语', async () => {
      const result = await service.createPhrase(
        { name: '主诉模板', category: '主诉', content: '患者自述牙痛' },
        'doctor-001'
      );

      expect(result).toBeDefined();
      expect((result as any).id).toBeDefined();

      const phrases = db.getTableData('MedicalRecordPhrase');
      expect(phrases.length).toBe(1);
    });

    it('获取常用语列表', async () => {
      db.seed('MedicalRecordPhrase', [
        { id: 'phrase-001', name: '牙痛', category: '主诉', content: '左下后牙疼痛', clinicId: 'test-clinic-001' },
        { id: 'phrase-002', name: '补牙', category: '治疗', content: '树脂充填', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.listPhrases('doctor-001');

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });

    it('删除常用语', async () => {
      db.seed('MedicalRecordPhrase', [
        { id: 'phrase-001', name: '牙痛', category: '主诉', content: '左下后牙疼痛', clinicId: 'test-clinic-001' },
      ]);

      const result = await service.deletePhrase('phrase-001', 'doctor-001');

      expect(result).toBeDefined();
    });
  });

  describe('findOne - 查询单份病历', () => {
    it('查询存在的病历', async () => {
      db.seed('MedicalRecord', [
        {
          id: 'record-001',
          patientId: 'p1',
          doctorId: 'd1',
          chiefComplaint: '测试主诉',
          isLocked: 0,
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.findOne('record-001');

      expect(result).toBeDefined();
      expect((result as any).chiefComplaint).toBe('测试主诉');
    });

    it('查询不存在的病历应抛出 NotFoundException', async () => {
      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== listModifyRequests ====================

  describe('listModifyRequests - 查询修改申请列表', () => {
    beforeEach(() => {
      db.seed('RecordModifyRequest', [
        { id: 'req-001', recordId: 'r1', applicantId: 'd1', reason: '需要补充', status: 'PENDING', reviewerId: null, reviewRemark: null, reviewedAt: null, clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'req-002', recordId: 'r2', applicantId: 'd2', reason: '信息有误', status: 'APPROVED', reviewerId: 'r1', reviewRemark: '同意', reviewedAt: '2026-01-02', clinicId: 'test-clinic-001', createdAt: '2026-01-02' },
        { id: 'req-003', recordId: 'r3', applicantId: 'd3', reason: '需要修改', status: 'REJECTED', reviewerId: 'r1', reviewRemark: '拒绝', reviewedAt: '2026-01-03', clinicId: 'test-clinic-001', createdAt: '2026-01-03' },
      ]);
    });

    it('不带状态过滤应返回所有申请', async () => {
      const result = await service.listModifyRequests();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
    });

    it('按状态过滤应只返回匹配状态的申请', async () => {
      const result = await service.listModifyRequests('PENDING');

      expect(result.length).toBe(1);
      expect((result[0] as any).status).toBe('PENDING');
    });

    it('按 APPROVED 状态过滤应只返回已通过的申请', async () => {
      const result = await service.listModifyRequests('APPROVED');

      expect(result.length).toBe(1);
      expect((result[0] as any).status).toBe('APPROVED');
    });

    it('按 REJECTED 状态过滤应只返回已拒绝的申请', async () => {
      const result = await service.listModifyRequests('REJECTED');

      expect(result.length).toBe(1);
      expect((result[0] as any).status).toBe('REJECTED');
    });

    it('无申请时返回空数组', async () => {
      db.clear();
      const result = await service.listModifyRequests();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  // ==================== createModifyRequest - 更多场景 ====================

  describe('createModifyRequest - 更多场景', () => {
    it('创建修改申请应默认状态为 PENDING', async () => {
      const result = await service.createModifyRequest(
        { recordId: 'record-x', reason: '测试' },
        'doctor-001'
      );

      expect(result).toBeDefined();
      expect((result as any).id).toBeDefined();

      const requests = db.getTableData('RecordModifyRequest');
      const created = requests.find(r => r.id === (result as any).id);
      expect(created.status).toBe('PENDING');
      expect(created.applicantId).toBe('doctor-001');
    });

    it('创建修改申请不带申请人时 applicantId 应为 null', async () => {
      const result = await service.createModifyRequest(
        { recordId: 'record-y', reason: '测试2' }
      );

      const requests = db.getTableData('RecordModifyRequest');
      const created = requests.find(r => r.id === (result as any).id);
      // 当 userId 为 undefined 时，safeDto.applicantId || userId || null 应为 null
      expect(created.applicantId).toBeNull();
    });

    it('创建修改申请应自动生成 id 和 createdAt', async () => {
      const result = await service.createModifyRequest(
        { recordId: 'record-z', reason: '测试3' },
        'doctor-001'
      );

      const requests = db.getTableData('RecordModifyRequest');
      const created = requests.find(r => r.id === (result as any).id);
      expect(created.id).toBeDefined();
      expect(created.createdAt).toBeDefined();
      expect(created.clinicId).toBe('test-clinic-001');
    });

    it('创建修改申请不带 reason 时 reason 应为空字符串', async () => {
      const result = await service.createModifyRequest(
        { recordId: 'record-w' },
        'doctor-001'
      );

      const requests = db.getTableData('RecordModifyRequest');
      const created = requests.find(r => r.id === (result as any).id);
      expect(created.reason).toBe('');
    });
  });

  // ==================== reviewModifyRequest - 更多场景 ====================

  describe('reviewModifyRequest - 更多场景', () => {
    // 注：MockDbService 不支持字面量 WHERE 条件（如 status = 'PENDING'），
    // 无法模拟幂等性检查（changes === 0 场景），故跳过此用例

    it('审批通过时 reviewRemark 可选', async () => {
      db.seed('MedicalRecord', [
        { id: 'r-lock-1', patientId: 'p1', doctorId: 'd1', chiefComplaint: 't', isLocked: 1, clinicId: 'test-clinic-001' },
      ]);
      db.seed('RecordModifyRequest', [
        { id: 'req-no-remark', recordId: 'r-lock-1', applicantId: 'd2', reason: 't', status: 'PENDING', reviewerId: null, reviewRemark: null, reviewedAt: null, clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);

      const result = await service.reviewModifyRequest('req-no-remark', { status: 'APPROVED' }, 'reviewer-001');

      expect((result as any).status).toBe('APPROVED');
      expect((result as any).reviewRemark).toBeNull();

      const records = db.getTableData('MedicalRecord');
      const record = records.find(r => r.id === 'r-lock-1');
      expect(record?.isLocked).toBe(0);
    });

    it('审批应写入审计日志', async () => {
      db.seed('MedicalRecord', [
        { id: 'r-audit', patientId: 'p1', doctorId: 'd1', chiefComplaint: 't', isLocked: 1, clinicId: 'test-clinic-001' },
      ]);
      db.seed('RecordModifyRequest', [
        { id: 'req-audit', recordId: 'r-audit', applicantId: 'd2', reason: 't', status: 'PENDING', reviewerId: null, reviewRemark: null, reviewedAt: null, clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);

      await service.reviewModifyRequest('req-audit', { status: 'APPROVED' }, 'reviewer-001');

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === 'req-audit' && l.type === 'MODIFY_REQUEST_REVIEW');
      expect(log).toBeDefined();
    });
  });

  // ==================== 模板管理 ====================

  describe('createTemplate - 创建病历模板', () => {
    it('正常创建病历模板', async () => {
      const result = await service.createTemplate({
        name: '根管治疗模板',
        category: '牙体牙髓',
        chiefComplaint: '牙痛',
        presentIllness: '冷热刺激痛',
        pastHistory: '体健',
        examination: '探诊(+)',
        diagnosis: '牙髓炎',
        treatmentPlan: '根管治疗',
      });

      expect(result).toBeDefined();
      expect((result as any).id).toBeDefined();

      const templates = db.getTableData('MedicalRecordTemplate');
      expect(templates.length).toBe(1);
      expect(templates[0].name).toBe('根管治疗模板');
      expect(templates[0].category).toBe('牙体牙髓');
    });

    it('创建模板应包含 clinicId', async () => {
      await service.createTemplate({ name: '简单模板' });

      const templates = db.getTableData('MedicalRecordTemplate');
      expect(templates[0].clinicId).toBe('test-clinic-001');
    });

    it('创建模板不带 name 时 name 应为空字符串', async () => {
      await service.createTemplate({ category: '修复' });

      const templates = db.getTableData('MedicalRecordTemplate');
      expect(templates[0].name).toBe('');
    });

    it('创建模板不带 category 时 category 应为 null', async () => {
      await service.createTemplate({ name: '无类别模板' });

      const templates = db.getTableData('MedicalRecordTemplate');
      expect(templates[0].category).toBeNull();
    });

    it('创建模板应自动生成 id 和 createdAt', async () => {
      const result = await service.createTemplate({ name: '模板1' });

      const templates = db.getTableData('MedicalRecordTemplate');
      const created = templates.find(t => t.id === (result as any).id);
      expect(created.id).toBeDefined();
      expect(created.createdAt).toBeDefined();
    });
  });

  describe('listTemplates - 查询病历模板列表', () => {
    beforeEach(() => {
      db.seed('MedicalRecordTemplate', [
        { id: 'tpl-1', name: '根管模板', category: '牙体牙髓', chiefComplaint: '牙痛', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'tpl-2', name: '修复模板', category: '修复', chiefComplaint: '缺损', clinicId: 'test-clinic-001', createdAt: '2026-01-02' },
      ]);
    });

    it('查询模板列表应返回所有模板', async () => {
      const result = await service.listTemplates();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(2);
    });

    it('无模板时返回空数组', async () => {
      db.clear();
      const result = await service.listTemplates();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    it('查询带 userId 不影响结果（参数占位）', async () => {
      const result = await service.listTemplates('doctor-001');

      expect(result.length).toBe(2);
    });
  });

  describe('updateTemplate - 更新病历模板', () => {
    beforeEach(() => {
      db.seed('MedicalRecordTemplate', [
        { id: 'tpl-1', name: '原模板', category: '原类别', chiefComplaint: '原主诉', presentIllness: '原病史', pastHistory: '原既往', examination: '原检查', diagnosis: '原诊断', treatmentPlan: '原计划', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
    });

    it('更新模板名称应成功', async () => {
      const result = await service.updateTemplate('tpl-1', { name: '新模板名' });

      expect((result as any).id).toBe('tpl-1');
      const templates = db.getTableData('MedicalRecordTemplate');
      expect(templates[0].name).toBe('新模板名');
    });

    it('更新模板多个字段应成功', async () => {
      await service.updateTemplate('tpl-1', {
        name: '更新名称',
        category: '更新类别',
        chiefComplaint: '更新主诉',
        diagnosis: '更新诊断',
        treatmentPlan: '更新计划',
      });

      const templates = db.getTableData('MedicalRecordTemplate');
      expect(templates[0].name).toBe('更新名称');
      expect(templates[0].category).toBe('更新类别');
      expect(templates[0].chiefComplaint).toBe('更新主诉');
      expect(templates[0].diagnosis).toBe('更新诊断');
      expect(templates[0].treatmentPlan).toBe('更新计划');
    });

    it('空对象更新不应抛出异常', async () => {
      const result = await service.updateTemplate('tpl-1', {});

      expect(result).toBeDefined();
      expect((result as any).id).toBe('tpl-1');
    });

    it('更新不存在的模板不应抛出异常（无校验）', async () => {
      const result = await service.updateTemplate('non-existent', { name: 'test' });

      expect(result).toBeDefined();
      expect((result as any).id).toBe('non-existent');
    });
  });

  describe('deleteTemplate - 删除病历模板', () => {
    beforeEach(() => {
      db.seed('MedicalRecordTemplate', [
        { id: 'tpl-1', name: '待删除', category: 'cat', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
    });

    it('删除存在的模板应返回 id', async () => {
      const result = await service.deleteTemplate('tpl-1');

      expect((result as any).id).toBe('tpl-1');

      const templates = db.getTableData('MedicalRecordTemplate');
      const deleted = templates.find(t => t.id === 'tpl-1');
      expect(deleted?.deletedAt).toBeTruthy();
    });

    it('删除模板应设置 deletedAt', async () => {
      await service.deleteTemplate('tpl-1');

      const templates = db.getTableData('MedicalRecordTemplate');
      expect(templates[0].deletedAt).toBeDefined();
    });

    it('删除不存在的模板不应抛出异常', async () => {
      const result = await service.deleteTemplate('non-existent');

      expect((result as any).id).toBe('non-existent');
    });
  });

  // ==================== 常用语 - 更多场景 ====================

  describe('updatePhrase - 更新常用语', () => {
    beforeEach(() => {
      db.seed('MedicalRecordPhrase', [
        { id: 'phrase-1', name: '牙痛', category: '主诉', content: '左下后牙疼痛', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
    });

    it('更新常用语内容应成功', async () => {
      const result = await service.updatePhrase('phrase-1', { content: '更新后的内容' });

      expect((result as any).id).toBe('phrase-1');
      const phrases = db.getTableData('MedicalRecordPhrase');
      expect(phrases[0].content).toBe('更新后的内容');
    });

    it('更新常用语类别应成功', async () => {
      await service.updatePhrase('phrase-1', { category: '治疗' });

      const phrases = db.getTableData('MedicalRecordPhrase');
      expect(phrases[0].category).toBe('治疗');
    });

    it('更新常用语名称应成功', async () => {
      await service.updatePhrase('phrase-1', { name: '新名称' });

      const phrases = db.getTableData('MedicalRecordPhrase');
      expect(phrases[0].name).toBe('新名称');
    });

    it('更新多个字段应全部生效', async () => {
      await service.updatePhrase('phrase-1', {
        name: '完整更新',
        category: '检查',
        content: '新内容',
      });

      const phrases = db.getTableData('MedicalRecordPhrase');
      expect(phrases[0].name).toBe('完整更新');
      expect(phrases[0].category).toBe('检查');
      expect(phrases[0].content).toBe('新内容');
    });

    it('空对象更新不应抛出异常', async () => {
      const result = await service.updatePhrase('phrase-1', {});

      expect(result).toBeDefined();
      expect((result as any).id).toBe('phrase-1');
    });
  });

  describe('createPhrase - 更多场景', () => {
    it('创建常用语不带 name 时使用 content 作为 name', async () => {
      const result = await service.createPhrase({ content: '只传内容' }, 'doctor-001');

      const phrases = db.getTableData('MedicalRecordPhrase');
      const created = phrases.find(p => p.id === (result as any).id);
      expect(created.name).toBe('只传内容');
    });

    it('创建常用语不带 name 和 content 时 name 应为空字符串', async () => {
      const result = await service.createPhrase({ category: '其他' }, 'doctor-001');

      const phrases = db.getTableData('MedicalRecordPhrase');
      const created = phrases.find(p => p.id === (result as any).id);
      expect(created.name).toBe('');
      expect(created.content).toBe('');
    });

    it('创建常用语不带 category 时 category 应为 null', async () => {
      const result = await service.createPhrase({ name: '测试', content: '内容' }, 'doctor-001');

      const phrases = db.getTableData('MedicalRecordPhrase');
      const created = phrases.find(p => p.id === (result as any).id);
      expect(created.category).toBeNull();
    });

    it('创建常用语应包含 clinicId', async () => {
      const result = await service.createPhrase({ name: '测试' }, 'doctor-001');

      const phrases = db.getTableData('MedicalRecordPhrase');
      const created = phrases.find(p => p.id === (result as any).id);
      expect(created.clinicId).toBe('test-clinic-001');
    });
  });

  describe('listPhrases - 查询常用语列表', () => {
    beforeEach(() => {
      db.seed('MedicalRecordPhrase', [
        { id: 'p-1', name: '牙痛', category: '主诉', content: '左下后牙疼痛', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'p-2', name: '补牙', category: '治疗', content: '树脂充填', clinicId: 'test-clinic-001', createdAt: '2026-01-02' },
        { id: 'p-3', name: '复查', category: '其他', content: '定期复查', clinicId: 'test-clinic-001', createdAt: '2026-01-03' },
      ]);
    });

    it('不带过滤条件应返回所有常用语', async () => {
      const result = await service.listPhrases();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(3);
    });

    it('带 userId 不影响结果（参数占位）', async () => {
      const result = await service.listPhrases('doctor-001');

      expect(result.length).toBe(3);
    });

    it('带 userId 和 category 不影响结果（参数占位）', async () => {
      const result = await service.listPhrases('doctor-001', '主诉');

      expect(result.length).toBe(3);
    });

    it('无常用语时返回空数组', async () => {
      db.clear();
      const result = await service.listPhrases();

      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });
  });

  describe('deletePhrase - 删除常用语', () => {
    it('删除不存在的常用语不应抛出异常', async () => {
      const result = await service.deletePhrase('non-existent', 'doctor-001');

      expect((result as any).id).toBe('non-existent');
    });

    it('删除常用语应设置 deletedAt', async () => {
      db.seed('MedicalRecordPhrase', [
        { id: 'phrase-x', name: '待删除', category: '主诉', content: '内容', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);

      await service.deletePhrase('phrase-x', 'doctor-001');

      const phrases = db.getTableData('MedicalRecordPhrase');
      const deleted = phrases.find(p => p.id === 'phrase-x');
      expect(deleted?.deletedAt).toBeTruthy();
    });
  });

  // ==================== update - 更多字段组合 ====================

  describe('update - 更多字段组合', () => {
    beforeEach(() => {
      db.seed('MedicalRecord', [
        {
          id: 'record-multi',
          patientId: 'p1',
          doctorId: 'd1',
          chiefComplaint: '原主诉',
          presentIllness: '原病史',
          pastHistory: '原既往史',
          examination: '原检查',
          diagnosis: '原诊断',
          treatmentPlan: '原计划',
          isLocked: 0,
          clinicId: 'test-clinic-001',
        },
      ]);
    });

    it('只更新 presentIllness 应成功', async () => {
      const result = await service.update('record-multi', { presentIllness: '新病史' });

      expect((result as any).presentIllness).toBe('新病史');
      expect((result as any).chiefComplaint).toBe('原主诉');
    });

    it('只更新 pastHistory 应成功', async () => {
      const result = await service.update('record-multi', { pastHistory: '新既往史' });

      expect((result as any).pastHistory).toBe('新既往史');
    });

    it('只更新 examination 应成功', async () => {
      const result = await service.update('record-multi', { examination: '新检查' });

      expect((result as any).examination).toBe('新检查');
    });

    it('只更新 treatmentPlan 应成功', async () => {
      const result = await service.update('record-multi', { treatmentPlan: '新计划' });

      expect((result as any).treatmentPlan).toBe('新计划');
    });

    it('同时更新所有可修改字段应成功', async () => {
      const result = await service.update('record-multi', {
        chiefComplaint: '主诉1',
        presentIllness: '病史1',
        pastHistory: '既往1',
        examination: '检查1',
        diagnosis: '诊断1',
        treatmentPlan: '计划1',
      });

      expect((result as any).chiefComplaint).toBe('主诉1');
      expect((result as any).presentIllness).toBe('病史1');
      expect((result as any).pastHistory).toBe('既往1');
      expect((result as any).examination).toBe('检查1');
      expect((result as any).diagnosis).toBe('诊断1');
      expect((result as any).treatmentPlan).toBe('计划1');
    });

    it('空对象更新不应修改任何字段', async () => {
      const result = await service.update('record-multi', {});

      expect((result as any).chiefComplaint).toBe('原主诉');
      expect((result as any).diagnosis).toBe('原诊断');
    });

    it('更新应写入审计日志', async () => {
      await service.update('record-multi', { chiefComplaint: '新主诉' });

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === 'record-multi' && l.type === 'MEDICAL_RECORD_UPDATE');
      expect(log).toBeDefined();
    });
  });

  // ==================== lock - 更多场景 ====================

  describe('lock - 更多场景', () => {
    it('锁定病历应写入审计日志', async () => {
      db.seed('MedicalRecord', [
        { id: 'r-lock-audit', patientId: 'p1', doctorId: 'd1', chiefComplaint: 't', isLocked: 0, clinicId: 'test-clinic-001' },
      ]);

      await service.lock('r-lock-audit', 'doctor-001');

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === 'r-lock-audit' && l.type === 'MEDICAL_RECORD_LOCK');
      expect(log).toBeDefined();
    });

    it('锁定后 isLocked 应为 1，lockedAt 和 lockedBy 应被设置', async () => {
      db.seed('MedicalRecord', [
        { id: 'r-lock-fields', patientId: 'p1', doctorId: 'd1', chiefComplaint: 't', isLocked: 0, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.lock('r-lock-fields', 'doctor-001');

      expect((result as any).isLocked).toBe(1);
      expect((result as any).lockedBy).toBe('doctor-001');
      expect((result as any).lockedAt).toBeDefined();
    });

    it('不带 userId 锁定时 lockedBy 应为 null', async () => {
      db.seed('MedicalRecord', [
        { id: 'r-lock-no-user', patientId: 'p1', doctorId: 'd1', chiefComplaint: 't', isLocked: 0, clinicId: 'test-clinic-001' },
      ]);

      const result = await service.lock('r-lock-no-user');

      expect((result as any).isLocked).toBe(1);
      expect((result as any).lockedBy).toBeNull();
    });
  });

  // ==================== create - 更多场景 ====================

  describe('create - 更多场景', () => {
    it('创建病历应包含 clinicId', async () => {
      const result = await service.create({ patientId: 'p1', doctorId: 'd1' });

      const rows = db.getTableData('MedicalRecord');
      const created = rows.find(r => r.id === (result as any).id);
      expect(created.clinicId).toBe('test-clinic-001');
    });

    it('创建病历应自动生成 id 和 createdAt', async () => {
      const result = await service.create({ patientId: 'p1', doctorId: 'd1' });

      expect((result as any).id).toBeDefined();
      expect((result as any).createdAt).toBeDefined();
    });

    it('创建病历带 visitId 应正确存储', async () => {
      const result = await service.create({
        patientId: 'p1',
        visitId: 'visit-001',
        doctorId: 'd1',
      });

      expect((result as any).visitId).toBe('visit-001');
    });

    it('创建病历带 allergyHistory 应正确存储', async () => {
      const result = await service.create({
        patientId: 'p1',
        doctorId: 'd1',
        allergyHistory: '青霉素过敏',
      });

      expect((result as any).allergyHistory).toBe('青霉素过敏');
    });

    it('创建病历带完整字段应正确存储', async () => {
      const result = await service.create({
        patientId: 'p1',
        visitId: 'v1',
        doctorId: 'd1',
        chiefComplaint: '主诉',
        presentIllness: '病史',
        pastHistory: '既往',
        allergyHistory: '过敏',
        examination: '检查',
        diagnosis: '诊断',
        treatmentPlan: '计划',
        teethInvolved: ['11', '16'],
        images: ['img1.jpg'],
      });

      expect((result as any).patientId).toBe('p1');
      expect((result as any).visitId).toBe('v1');
      expect((result as any).doctorId).toBe('d1');
    });
  });

  // ==================== 缓存命中场景 ====================

  describe('listPhrases - 缓存命中', () => {
    it('缓存命中时应直接返回缓存数据', async () => {
      const cachedPhrases = [
        { id: 'cached-1', name: '缓存常用语', category: '主诉', content: '缓存内容' },
      ];
      const cacheService = createMockCacheService();
      cacheService.get = jest.fn().mockReturnValue(cachedPhrases);
      const serviceWithCache = new MedicalRecordsService(db as any, createMockClinicContext(), cacheService);

      const result = await serviceWithCache.listPhrases();

      expect(result).toBe(cachedPhrases);
      expect(cacheService.get).toHaveBeenCalled();
      // 缓存命中时不应写入缓存
      expect(cacheService.set).not.toHaveBeenCalled();
    });

    it('缓存未命中时应查询数据库并写入缓存', async () => {
      db.seed('MedicalRecordPhrase', [
        { id: 'phrase-001', name: '牙痛', category: '主诉', content: '左下后牙疼痛', clinicId: 'test-clinic-001' },
      ]);
      const cacheService = createMockCacheService();
      const serviceWithCache = new MedicalRecordsService(db as any, createMockClinicContext(), cacheService);

      const result = await serviceWithCache.listPhrases();

      expect(result.length).toBe(1);
      expect(cacheService.set).toHaveBeenCalled();
    });
  });

  describe('listTemplates - 缓存命中', () => {
    it('缓存命中时应直接返回缓存数据', async () => {
      const cachedTemplates = [
        { id: 'cached-1', name: '缓存模板', category: '牙体牙髓' },
      ];
      const cacheService = createMockCacheService();
      cacheService.get = jest.fn().mockReturnValue(cachedTemplates);
      const serviceWithCache = new MedicalRecordsService(db as any, createMockClinicContext(), cacheService);

      const result = await serviceWithCache.listTemplates();

      expect(result).toBe(cachedTemplates);
      expect(cacheService.get).toHaveBeenCalled();
      expect(cacheService.set).not.toHaveBeenCalled();
    });

    it('缓存未命中时应查询数据库并写入缓存', async () => {
      db.seed('MedicalRecordTemplate', [
        { id: 'tpl-1', name: '根管模板', category: '牙体牙髓', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
      const cacheService = createMockCacheService();
      const serviceWithCache = new MedicalRecordsService(db as any, createMockClinicContext(), cacheService);

      const result = await serviceWithCache.listTemplates();

      expect(result.length).toBe(1);
      expect(cacheService.set).toHaveBeenCalled();
    });
  });

  // ==================== 缓存失效验证 ====================

  describe('缓存失效验证', () => {
    it('创建常用语后应失效常用语缓存', async () => {
      const cacheService = createMockCacheService();
      const serviceWithCache = new MedicalRecordsService(db as any, createMockClinicContext(), cacheService);

      await serviceWithCache.createPhrase({ name: '测试', content: '内容' }, 'doctor-001');

      expect(cacheService.delPattern).toHaveBeenCalled();
    });

    it('更新常用语后应失效常用语缓存', async () => {
      db.seed('MedicalRecordPhrase', [
        { id: 'phrase-1', name: '原名称', category: '主诉', content: '原内容', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
      const cacheService = createMockCacheService();
      const serviceWithCache = new MedicalRecordsService(db as any, createMockClinicContext(), cacheService);

      await serviceWithCache.updatePhrase('phrase-1', { content: '新内容' });

      expect(cacheService.delPattern).toHaveBeenCalled();
    });

    it('删除常用语后应失效常用语缓存', async () => {
      db.seed('MedicalRecordPhrase', [
        { id: 'phrase-1', name: '待删除', category: '主诉', content: '内容', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
      const cacheService = createMockCacheService();
      const serviceWithCache = new MedicalRecordsService(db as any, createMockClinicContext(), cacheService);

      await serviceWithCache.deletePhrase('phrase-1', 'doctor-001');

      expect(cacheService.delPattern).toHaveBeenCalled();
    });

    it('创建模板后应失效模板缓存', async () => {
      const cacheService = createMockCacheService();
      const serviceWithCache = new MedicalRecordsService(db as any, createMockClinicContext(), cacheService);

      await serviceWithCache.createTemplate({ name: '测试模板' });

      expect(cacheService.delPattern).toHaveBeenCalled();
    });

    it('更新模板后应失效模板缓存', async () => {
      db.seed('MedicalRecordTemplate', [
        { id: 'tpl-1', name: '原模板', category: '牙体牙髓', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
      const cacheService = createMockCacheService();
      const serviceWithCache = new MedicalRecordsService(db as any, createMockClinicContext(), cacheService);

      await serviceWithCache.updateTemplate('tpl-1', { name: '新模板' });

      expect(cacheService.delPattern).toHaveBeenCalled();
    });

    it('删除模板后应失效模板缓存', async () => {
      db.seed('MedicalRecordTemplate', [
        { id: 'tpl-1', name: '待删除', category: '牙体牙髓', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
      const cacheService = createMockCacheService();
      const serviceWithCache = new MedicalRecordsService(db as any, createMockClinicContext(), cacheService);

      await serviceWithCache.deleteTemplate('tpl-1');

      expect(cacheService.delPattern).toHaveBeenCalled();
    });
  });

  // ==================== reviewModifyRequest - 边界场景 ====================

  describe('reviewModifyRequest - 边界场景', () => {
    it('审批状态非 APPROVED/REJECTED 应抛出 BadRequestException', async () => {
      db.seed('RecordModifyRequest', [
        {
          id: 'req-001',
          recordId: 'r1',
          applicantId: 'd1',
          reason: 'test',
          status: 'PENDING',
          clinicId: 'test-clinic-001',
          createdAt: '2026-01-01',
        },
      ]);

      await expect(
        service.reviewModifyRequest('req-001', { status: 'PENDING' }, 'reviewer-001')
      ).rejects.toThrow(BadRequestException);
    });

    it('审批通过的病历应保持解锁状态（isLocked = 0）', async () => {
      db.seed('MedicalRecord', [
        { id: 'record-unlock-001', patientId: 'p1', doctorId: 'd1', chiefComplaint: 't', isLocked: 1, clinicId: 'test-clinic-001' },
      ]);
      db.seed('RecordModifyRequest', [
        { id: 'req-unlock-001', recordId: 'record-unlock-001', applicantId: 'd2', reason: 't', status: 'PENDING', reviewerId: null, reviewRemark: null, reviewedAt: null, clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);

      await service.reviewModifyRequest('req-unlock-001', { status: 'APPROVED' }, 'reviewer-001');

      const records = db.getTableData('MedicalRecord');
      const record = records.find(r => r.id === 'record-unlock-001');
      expect(record?.isLocked).toBe(0);
      expect(record?.lockedAt).toBeNull();
      expect(record?.lockedBy).toBeNull();
    });

    it('审批拒绝的病历应保持锁定状态（isLocked = 1）', async () => {
      db.seed('MedicalRecord', [
        { id: 'record-locked-002', patientId: 'p1', doctorId: 'd1', chiefComplaint: 't', isLocked: 1, lockedAt: '2026-01-01', lockedBy: 'd1', clinicId: 'test-clinic-001' },
      ]);
      db.seed('RecordModifyRequest', [
        { id: 'req-reject-002', recordId: 'record-locked-002', applicantId: 'd2', reason: 't', status: 'PENDING', reviewerId: null, reviewRemark: null, reviewedAt: null, clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);

      await service.reviewModifyRequest('req-reject-002', { status: 'REJECTED', reviewRemark: '拒绝' }, 'reviewer-001');

      const records = db.getTableData('MedicalRecord');
      const record = records.find(r => r.id === 'record-locked-002');
      expect(record?.isLocked).toBe(1);
    });

    it('审批应记录 reviewerId 和 reviewedAt', async () => {
      db.seed('MedicalRecord', [
        { id: 'record-audit-003', patientId: 'p1', doctorId: 'd1', chiefComplaint: 't', isLocked: 1, clinicId: 'test-clinic-001' },
      ]);
      db.seed('RecordModifyRequest', [
        { id: 'req-audit-003', recordId: 'record-audit-003', applicantId: 'd2', reason: 't', status: 'PENDING', reviewerId: null, reviewRemark: null, reviewedAt: null, clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);

      const result = await service.reviewModifyRequest('req-audit-003', { status: 'APPROVED' }, 'reviewer-001') as any;

      expect(result.reviewerId).toBe('reviewer-001');
      expect(result.reviewedAt).toBeDefined();
    });

    it('不传 reviewRemark 时 reviewRemark 应为 null', async () => {
      db.seed('MedicalRecord', [
        { id: 'record-noremark-004', patientId: 'p1', doctorId: 'd1', chiefComplaint: 't', isLocked: 1, clinicId: 'test-clinic-001' },
      ]);
      db.seed('RecordModifyRequest', [
        { id: 'req-noremark-004', recordId: 'record-noremark-004', applicantId: 'd2', reason: 't', status: 'PENDING', reviewerId: null, reviewRemark: null, reviewedAt: null, clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);

      const result = await service.reviewModifyRequest('req-noremark-004', { status: 'REJECTED' }, 'reviewer-001') as any;

      expect(result.reviewRemark).toBeNull();
    });

    it('不传 reviewerId 时 reviewerId 应为 null', async () => {
      db.seed('MedicalRecord', [
        { id: 'record-noreviewer-005', patientId: 'p1', doctorId: 'd1', chiefComplaint: 't', isLocked: 1, clinicId: 'test-clinic-001' },
      ]);
      db.seed('RecordModifyRequest', [
        { id: 'req-noreviewer-005', recordId: 'record-noreviewer-005', applicantId: 'd2', reason: 't', status: 'PENDING', reviewerId: null, reviewRemark: null, reviewedAt: null, clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);

      const result = await service.reviewModifyRequest('req-noreviewer-005', { status: 'APPROVED' }) as any;

      expect(result.reviewerId).toBeNull();
    });
  });

  // ==================== 跨诊所隔离 ====================

  describe('跨诊所隔离', () => {
    it('查询常用语应只返回当前诊所的常用语', async () => {
      db.seed('MedicalRecordPhrase', [
        { id: 'phrase-1', name: '本诊所', category: '主诉', content: '内容1', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'phrase-2', name: '其他诊所', category: '主诉', content: '内容2', clinicId: 'other-clinic-002', createdAt: '2026-01-01' },
      ]);

      const result = await service.listPhrases();

      expect(result.length).toBe(1);
      expect((result[0] as any).id).toBe('phrase-1');
    });

    it('查询模板应只返回当前诊所的模板', async () => {
      db.seed('MedicalRecordTemplate', [
        { id: 'tpl-1', name: '本诊所', category: '牙体牙髓', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'tpl-2', name: '其他诊所', category: '修复', clinicId: 'other-clinic-002', createdAt: '2026-01-01' },
      ]);

      const result = await service.listTemplates();

      expect(result.length).toBe(1);
      expect((result[0] as any).id).toBe('tpl-1');
    });

    it('查询修改申请应只返回当前诊所的申请', async () => {
      db.seed('RecordModifyRequest', [
        { id: 'req-1', recordId: 'r1', applicantId: 'd1', reason: '本诊所', status: 'PENDING', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'req-2', recordId: 'r2', applicantId: 'd2', reason: '其他诊所', status: 'PENDING', clinicId: 'other-clinic-002', createdAt: '2026-01-01' },
      ]);

      const result = await service.listModifyRequests();

      expect(result.length).toBe(1);
      expect((result[0] as any).id).toBe('req-1');
    });
  });

  // ==================== create - 边界场景补充 ====================

  describe('create - 边界场景补充', () => {
    // 注：MedicalRecordsService.create 委托 super.create()，BaseService.create 不写审计日志

    it('创建病历应包含 teethInvolved 字段', async () => {
      const result = await service.create({
        patientId: 'p1',
        doctorId: 'd1',
        teethInvolved: ['11', '21'],
      });

      expect((result as any).teethInvolved).toBeDefined();
    });

    it('创建病历应包含 images 字段', async () => {
      const result = await service.create({
        patientId: 'p1',
        doctorId: 'd1',
        images: ['img1.jpg', 'img2.jpg'],
      });

      expect((result as any).images).toBeDefined();
    });
  });

  // ==================== update - 审计日志验证 ====================

  describe('update - 审计日志验证', () => {
    it('更新病历的审计日志应包含更新字段', async () => {
      db.seed('MedicalRecord', [
        {
          id: 'record-audit',
          patientId: 'p1',
          doctorId: 'd1',
          chiefComplaint: '原主诉',
          diagnosis: '原诊断',
          isLocked: 0,
          clinicId: 'test-clinic-001',
        },
      ]);

      await service.update('record-audit', {
        chiefComplaint: '新主诉',
        diagnosis: '新诊断',
      });

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === 'record-audit' && l.type === 'MEDICAL_RECORD_UPDATE') as any;
      expect(log).toBeDefined();
      const afterData = JSON.parse(log.afterData);
      expect(afterData.chiefComplaint).toBe('新主诉');
      expect(afterData.diagnosis).toBe('新诊断');
    });
  });
});
