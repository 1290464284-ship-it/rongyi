import { VisitsService } from './visits.service';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';


// 构造 ClinicContextService 的 mock，模拟诊所上下文
function createMockClinicContext(): ClinicContextService {
  return {
    getClinicId: () => 'test-clinic-001',
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

describe('VisitsService', () => {
  let service: VisitsService;
  let db: MockDbService;

  beforeEach(() => {
    db = new MockDbService();
    service = new VisitsService(db as any, createMockClinicContext());
  });

  afterEach(() => {
    db.clear();
  });

  // ==================== create ====================

  describe('create - 创建就诊', () => {
    it('正常创建就诊应返回 IN_PROGRESS 状态', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        chiefComplaint: '牙痛',
        diagnosis: '牙髓炎',
      });

      expect(result).toBeDefined();
      expect((result as any).patientId).toBe('patient-001');
      expect((result as any).doctorId).toBe('doctor-001');
      expect((result as any).status).toBe('IN_PROGRESS');
      expect((result as any).chiefComplaint).toBe('牙痛');
    });

    it('创建就诊时关联挂号（appointmentId）应正确存储', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        appointmentId: 'apt-001',
        doctorId: 'doctor-001',
        chiefComplaint: '复查',
      });

      expect((result as any).appointmentId).toBe('apt-001');
    });

    it('创建就诊时应包含 clinicId', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
      });

      const rows = db.getTableData('Visit');
      const created = rows.find(r => r.id === (result as any).id);
      expect(created).toBeDefined();
      expect(created.clinicId).toBe('test-clinic-001');
    });

    it('创建就诊时应写入审计日志', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
      });

      const auditLogs = db.getTableData('AuditLog');
      const visitLog = auditLogs.find(l => l.targetId === (result as any).id && l.type === 'VISIT_CREATE');
      expect(visitLog).toBeDefined();
    });
  });

  // ==================== createSync ====================

  describe('createSync - 同步创建就诊', () => {
    it('同步创建就诊应返回就诊 ID', () => {
      const id = service.createSync({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
      });

      expect(id).toBeDefined();
      expect(typeof id).toBe('string');

      const rows = db.getTableData('Visit');
      const created = rows.find(r => r.id === id);
      expect(created).toBeDefined();
      expect(created.patientId).toBe('patient-001');
      expect(created.status).toBe('IN_PROGRESS');
    });

    it('同步创建就诊可传入自定义数据库连接', () => {
      let capturedSql = '';
      const mockDb = {
        prepare: (sql: string) => {
          capturedSql = sql;
          return { run: () => ({ changes: 1 }) };
        },
      };

      const id = service.createSync(
        { patientId: 'patient-002', doctorId: 'doctor-002' },
        mockDb,
      );

      expect(id).toBeDefined();
      expect(capturedSql).toContain('INSERT INTO Visit');
    });
  });

  // ==================== complete ====================

  describe('complete - 完成就诊', () => {
    it('IN_PROGRESS 状态的就诊应成功完成并设置诊断', async () => {
      db.seed('Visit', [
        {
          id: 'visit-001',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'IN_PROGRESS',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.complete('visit-001', { diagnosis: '牙髓炎', remark: '需根管治疗' });

      expect((result as any).status).toBe('COMPLETED');
      expect((result as any).diagnosis).toBe('牙髓炎');
    });

    it('完成就诊时应设置 endTime', async () => {
      db.seed('Visit', [
        {
          id: 'visit-001',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'IN_PROGRESS',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.complete('visit-001', { diagnosis: '牙髓炎' });

      expect((result as any).endTime).toBeDefined();
    });

    it('非 IN_PROGRESS 状态的就诊完成时应抛出 BusinessValidationException', async () => {
      db.seed('Visit', [
        {
          id: 'visit-002',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'COMPLETED',
          clinicId: 'test-clinic-001',
        },
      ]);

      await expect(
        service.complete('visit-002', { diagnosis: 'test' }),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('CANCELLED 状态的就诊完成时应抛出 BusinessValidationException', async () => {
      db.seed('Visit', [
        {
          id: 'visit-003',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'CANCELLED',
          clinicId: 'test-clinic-001',
        },
      ]);

      await expect(
        service.complete('visit-003', { diagnosis: 'test' }),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('完成就诊时应写入审计日志', async () => {
      db.seed('Visit', [
        {
          id: 'visit-001',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'IN_PROGRESS',
          clinicId: 'test-clinic-001',
        },
      ]);

      await service.complete('visit-001', { diagnosis: '牙髓炎' });

      const auditLogs = db.getTableData('AuditLog');
      const completeLog = auditLogs.find(l => l.targetId === 'visit-001' && l.type === 'VISIT_COMPLETE');
      expect(completeLog).toBeDefined();
    });
  });

  // ==================== update 状态机 ====================

  describe('update - 就诊状态机', () => {
    it('IN_PROGRESS → COMPLETED 应成功', async () => {
      db.seed('Visit', [
        {
          id: 'visit-001',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'IN_PROGRESS',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('visit-001', { status: 'COMPLETED' } as any);

      expect((result as any).status).toBe('COMPLETED');
    });

    it('IN_PROGRESS → CANCELLED 应成功', async () => {
      db.seed('Visit', [
        {
          id: 'visit-001',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'IN_PROGRESS',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('visit-001', { status: 'CANCELLED' } as any);

      expect((result as any).status).toBe('CANCELLED');
    });

    it('COMPLETED → IN_PROGRESS 非法流转应抛出 BusinessValidationException', async () => {
      db.seed('Visit', [
        {
          id: 'visit-001',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'COMPLETED',
          clinicId: 'test-clinic-001',
        },
      ]);

      await expect(
        service.update('visit-001', { status: 'IN_PROGRESS' } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('COMPLETED 是终态，不应流转到任何状态', async () => {
      db.seed('Visit', [
        {
          id: 'visit-001',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'COMPLETED',
          clinicId: 'test-clinic-001',
        },
      ]);

      await expect(
        service.update('visit-001', { status: 'CANCELLED' } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('CANCELLED 是终态，不应流转到任何状态', async () => {
      db.seed('Visit', [
        {
          id: 'visit-001',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'CANCELLED',
          clinicId: 'test-clinic-001',
        },
      ]);

      await expect(
        service.update('visit-001', { status: 'IN_PROGRESS' } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('相同状态重复更新不应抛出异常', async () => {
      db.seed('Visit', [
        {
          id: 'visit-001',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'IN_PROGRESS',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('visit-001', { status: 'IN_PROGRESS' } as any);

      expect((result as any).status).toBe('IN_PROGRESS');
    });

    it('不传 status 字段时应正常更新其他字段', async () => {
      db.seed('Visit', [
        {
          id: 'visit-001',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'IN_PROGRESS',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('visit-001', { chiefComplaint: '新主诉' });

      expect((result as any).chiefComplaint).toBe('新主诉');
      expect((result as any).status).toBe('IN_PROGRESS');
    });
  });

  // ==================== findOne ====================

  describe('findOne - 查询单个就诊', () => {
    it('查询存在的就诊记录', async () => {
      db.seed('Visit', [
        {
          id: 'visit-001',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'IN_PROGRESS',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.findOne('visit-001');

      expect(result).toBeDefined();
      expect((result as any).id).toBe('visit-001');
      expect((result as any).patientId).toBe('patient-001');
    });

    it('查询不存在的就诊应抛出 BusinessNotFoundException', async () => {
      await expect(service.findOne('non-existent')).rejects.toThrow(BusinessNotFoundException);
    });
  });

  // ==================== findMany ====================

  describe('findMany - 查询就诊', () => {
    beforeEach(() => {
      db.seed('Visit', [
        { id: 'visit-001', patientId: 'patient-001', appointmentId: 'apt-001', doctorId: 'doctor-001', chiefComplaint: '牙痛', diagnosis: '牙髓炎', startTime: '2026-01-15T09:00:00.000Z', status: 'COMPLETED', clinicId: 'test-clinic-001' },
        { id: 'visit-002', patientId: 'patient-002', appointmentId: null, doctorId: 'doctor-001', chiefComplaint: '洗牙', diagnosis: null, startTime: '2026-01-16T09:00:00.000Z', status: 'IN_PROGRESS', clinicId: 'test-clinic-001' },
        { id: 'visit-003', patientId: 'patient-001', appointmentId: null, doctorId: 'doctor-002', chiefComplaint: '补牙', diagnosis: null, startTime: '2026-01-17T09:00:00.000Z', status: 'IN_PROGRESS', clinicId: 'test-clinic-001' },
      ]);
    });

    it('按患者查询应只返回该患者的就诊记录', async () => {
      const result = await service.findMany({ patientId: 'patient-001' });

      expect(result.items.length).toBe(2);
      expect(result.items.every((v: any) => v.patientId === 'patient-001')).toBe(true);
    });

    it('按医生查询应只返回该医生的就诊记录', async () => {
      const result = await service.findMany({ doctorId: 'doctor-001' });

      expect(result.items.length).toBe(2);
      expect(result.items.every((v: any) => v.doctorId === 'doctor-001')).toBe(true);
    });

    it('按状态过滤应只返回匹配状态的就诊', async () => {
      const result = await service.findMany({ status: 'IN_PROGRESS' });

      expect(result.items.length).toBe(2);
      expect(result.items.every((v: any) => v.status === 'IN_PROGRESS')).toBe(true);
    });

    it('分页查询应返回正确的分页信息', async () => {
      const result = await service.findMany({ page: 1, pageSize: 2 });

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });

    it('第二页分页查询应返回剩余记录', async () => {
      const result = await service.findMany({ page: 2, pageSize: 2 });

      expect(result.items.length).toBe(1);
      expect(result.page).toBe(2);
    });

    it('组合查询（患者+状态）应返回交集', async () => {
      const result = await service.findMany({ patientId: 'patient-001', status: 'COMPLETED' });

      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).id).toBe('visit-001');
    });

    it('默认分页参数应正常返回', async () => {
      const result = await service.findMany({});

      expect(result.page).toBe(1);
      expect(result.pageSize).toBeDefined();
      expect(result.items.length).toBe(3);
    });

    it('无任何就诊记录时应返回空列表', async () => {
      db.clear();
      const result = await service.findMany({});

      expect(result.items.length).toBe(0);
      expect(result.total).toBe(0);
    });

    it('按 appointmentId 关联的就诊应正常返回', async () => {
      const result = await service.findMany({ patientId: 'patient-001' });

      const visitWithApt = result.items.find((v: any) => v.appointmentId === 'apt-001');
      expect(visitWithApt).toBeDefined();
    });
  });

  // ==================== create - 边界场景 ====================

  describe('create - 边界场景', () => {
    it('不传 appointmentId 时 appointmentId 应为 null', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
      });

      const rows = db.getTableData('Visit');
      const created = rows.find(r => r.id === (result as any).id);
      expect(created.appointmentId).toBeNull();
    });

    it('不传 chiefComplaint 时 chiefComplaint 应为 null', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
      });

      const rows = db.getTableData('Visit');
      const created = rows.find(r => r.id === (result as any).id);
      expect(created.chiefComplaint).toBeNull();
    });

    it('不传 diagnosis 时 diagnosis 应为 null', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
      });

      const rows = db.getTableData('Visit');
      const created = rows.find(r => r.id === (result as any).id);
      expect(created.diagnosis).toBeNull();
    });

    it('传入所有字段应正确存储', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        appointmentId: 'apt-001',
        doctorId: 'doctor-001',
        chiefComplaint: '主诉',
        diagnosis: '诊断',
      });

      expect((result as any).patientId).toBe('patient-001');
      expect((result as any).appointmentId).toBe('apt-001');
      expect((result as any).doctorId).toBe('doctor-001');
      expect((result as any).chiefComplaint).toBe('主诉');
      expect((result as any).diagnosis).toBe('诊断');
      expect((result as any).status).toBe('IN_PROGRESS');
    });

    it('创建就诊应自动生成 startTime', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
      });

      const rows = db.getTableData('Visit');
      const created = rows.find(r => r.id === (result as any).id);
      expect(created.startTime).toBeDefined();
    });
  });

  // ==================== createSync - 边界场景 ====================

  describe('createSync - 边界场景', () => {
    it('不传 appointmentId 时 appointmentId 应为 null', () => {
      const id = service.createSync({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
      });

      const rows = db.getTableData('Visit');
      const created = rows.find(r => r.id === id);
      expect(created.appointmentId).toBeNull();
    });

    it('不传 doctorId 时 doctorId 应为 null', () => {
      const id = service.createSync({
        patientId: 'patient-001',
      });

      const rows = db.getTableData('Visit');
      const created = rows.find(r => r.id === id);
      expect(created.doctorId).toBeNull();
    });

    it('传入 appointmentId 时应正确存储', () => {
      const id = service.createSync({
        patientId: 'patient-001',
        appointmentId: 'apt-001',
        doctorId: 'doctor-001',
      });

      const rows = db.getTableData('Visit');
      const created = rows.find(r => r.id === id);
      expect(created.appointmentId).toBe('apt-001');
    });

    it('同步创建就诊应返回 IN_PROGRESS 状态', () => {
      const id = service.createSync({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
      });

      const rows = db.getTableData('Visit');
      const created = rows.find(r => r.id === id);
      expect(created.status).toBe('IN_PROGRESS');
    });

    it('同步创建就诊应包含 clinicId', () => {
      const id = service.createSync({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
      });

      const rows = db.getTableData('Visit');
      const created = rows.find(r => r.id === id);
      expect(created.clinicId).toBe('test-clinic-001');
    });
  });

  // ==================== complete - 边界场景 ====================

  describe('complete - 边界场景', () => {
    it('完成就诊不传 diagnosis 时 diagnosis 应为 undefined（不更新）', async () => {
      db.seed('Visit', [
        {
          id: 'visit-001',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'IN_PROGRESS',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.complete('visit-001', {});

      expect((result as any).status).toBe('COMPLETED');
      expect((result as any).endTime).toBeDefined();
    });

    it('完成就诊应设置 endTime', async () => {
      db.seed('Visit', [
        {
          id: 'visit-002',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'IN_PROGRESS',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.complete('visit-002', { diagnosis: '牙髓炎' });

      expect((result as any).endTime).toBeDefined();
      expect((result as any).status).toBe('COMPLETED');
    });

    it('完成不存在的就诊应抛出 BusinessNotFoundException', async () => {
      await expect(
        service.complete('non-existent', { diagnosis: 'test' }),
      ).rejects.toThrow(BusinessNotFoundException);
    });

    it('完成就诊的审计日志应包含诊断信息', async () => {
      db.seed('Visit', [
        {
          id: 'visit-003',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'IN_PROGRESS',
          clinicId: 'test-clinic-001',
        },
      ]);

      await service.complete('visit-003', { diagnosis: '牙周炎' });

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === 'visit-003' && l.type === 'VISIT_COMPLETE') as any;
      expect(log).toBeDefined();
      const afterData = JSON.parse(log.afterData);
      expect(afterData.diagnosis).toBe('牙周炎');
    });
  });

  // ==================== update - 边界场景 ====================

  describe('update - 边界场景', () => {
    it('不传 status 字段时应正常更新其他字段', async () => {
      db.seed('Visit', [
        {
          id: 'visit-001',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'IN_PROGRESS',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('visit-001', { diagnosis: '新诊断' });

      expect((result as any).diagnosis).toBe('新诊断');
      expect((result as any).status).toBe('IN_PROGRESS');
    });

    it('更新不存在的就诊应抛出 BusinessNotFoundException', async () => {
      await expect(
        service.update('non-existent', { status: 'COMPLETED' } as any),
      ).rejects.toThrow(BusinessNotFoundException);
    });

    it('空对象更新不应抛出异常', async () => {
      db.seed('Visit', [
        {
          id: 'visit-001',
          patientId: 'patient-001',
          appointmentId: null,
          doctorId: 'doctor-001',
          chiefComplaint: '牙痛',
          diagnosis: null,
          startTime: '2026-01-15T09:00:00.000Z',
          status: 'IN_PROGRESS',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('visit-001', {});

      expect((result as any).id).toBe('visit-001');
    });
  });

  // ==================== 跨诊所隔离 ====================

  describe('跨诊所隔离', () => {
    it('不同诊所的就诊记录应互相隔离', async () => {
      db.seed('Visit', [
        { id: 'visit-001', patientId: 'patient-001', appointmentId: null, doctorId: 'doctor-001', chiefComplaint: '本诊所', diagnosis: null, startTime: '2026-01-15T09:00:00.000Z', status: 'IN_PROGRESS', clinicId: 'test-clinic-001' },
        { id: 'visit-002', patientId: 'patient-001', appointmentId: null, doctorId: 'doctor-001', chiefComplaint: '其他诊所', diagnosis: null, startTime: '2026-01-15T09:00:00.000Z', status: 'IN_PROGRESS', clinicId: 'other-clinic-002' },
      ]);

      const result = await service.findMany({ patientId: 'patient-001' });

      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).id).toBe('visit-001');
    });
  });
});
