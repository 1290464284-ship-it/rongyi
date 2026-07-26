import { RegistrationsService } from './registrations.service';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { RegistrationStatus } from '@dental/shared';

// 构造 ClinicContextService 的 mock，模拟诊所上下文
function createMockClinicContext(clinicId: string | null = 'test-clinic-001'): ClinicContextService {
  return {
    getClinicId: () => clinicId,
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

// 构造 VisitsService 的 mock
function createMockVisitsService() {
  return {
    createSync: jest.fn().mockReturnValue('mock-visit-id'),
    create: jest.fn().mockResolvedValue({ id: 'mock-visit-id' }),
  } as any;
}

// 构造 AppointmentsService 的 mock
function createMockAppointmentsService() {
  return {
    linkVisitSync: jest.fn(),
    linkVisit: jest.fn(),
  } as any;
}

describe('RegistrationsService', () => {
  let service: RegistrationsService;
  let db: MockDbService;
  let mockVisitsService: ReturnType<typeof createMockVisitsService>;
  let mockAppointmentsService: ReturnType<typeof createMockAppointmentsService>;

  beforeEach(() => {
    db = new MockDbService();
    mockVisitsService = createMockVisitsService();
    mockAppointmentsService = createMockAppointmentsService();
    service = new RegistrationsService(
      db as any,
      createMockClinicContext(),
      mockVisitsService,
      mockAppointmentsService,
    );
  });

  afterEach(() => {
    db.clear();
    jest.clearAllMocks();
  });

  // ==================== create ====================

  describe('create - 创建挂号', () => {
    it('正常创建挂号应返回 REGISTERED 状态', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        type: 'FIRST_VISIT',
        chiefComplaint: '牙痛',
      });

      expect(result).toBeDefined();
      expect((result as any).patientId).toBe('patient-001');
      expect((result as any).doctorId).toBe('doctor-001');
      expect((result as any).type).toBe('FIRST_VISIT');
      expect((result as any).status).toBe('REGISTERED');
      expect((result as any).chiefComplaint).toBe('牙痛');
      expect((result as any).registeredAt).toBeDefined();
    });

    it('创建挂号应包含 clinicId', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        type: 'FIRST_VISIT',
      });

      const rows = db.getTableData('Registration');
      const created = rows.find(r => r.id === (result as any).id);
      expect(created).toBeDefined();
      expect(created.clinicId).toBe('test-clinic-001');
    });

    it('创建挂号应写入审计日志', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        type: 'RETURN_VISIT',
      });

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === (result as any).id && l.type === 'REGISTRATION_CREATE');
      expect(log).toBeDefined();
    });

    it('创建急诊挂号应成功', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        type: 'EMERGENCY',
        chiefComplaint: '外伤',
      });

      expect((result as any).type).toBe('EMERGENCY');
      expect((result as any).status).toBe('REGISTERED');
    });

    it('创建挂号应自动生成 id 和 createdAt', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        type: 'FIRST_VISIT',
      });

      expect((result as any).id).toBeDefined();
      expect((result as any).createdAt).toBeDefined();
    });

    it('创建挂号不传 chiefComplaint 时应为 null/undefined', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        type: 'FIRST_VISIT',
      });

      expect((result as any).chiefComplaint).toBeFalsy();
    });
  });

  // ==================== findOne ====================

  describe('findOne - 查询挂号详情', () => {
    it('查询存在的挂号应返回详情', async () => {
      db.seed('Registration', [
        {
          id: 'reg-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          type: 'FIRST_VISIT',
          status: 'REGISTERED',
          chiefComplaint: '牙痛',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.findOne('reg-001');

      expect(result).toBeDefined();
      expect((result as any).id).toBe('reg-001');
      expect((result as any).patientId).toBe('patient-001');
    });

    it('查询不存在的挂号应抛出 NotFoundException', async () => {
      await expect(service.findOne('non-existent')).rejects.toThrow(NotFoundException);
    });
  });

  // ==================== findMany ====================

  describe('findMany - 分页查询挂号', () => {
    beforeEach(() => {
      db.seed('Registration', [
        { id: 'reg-001', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'REGISTERED', registeredAt: '2026-01-10T09:00:00.000Z', clinicId: 'test-clinic-001', createdAt: '2026-01-10' },
        { id: 'reg-002', patientId: 'patient-002', doctorId: 'doctor-001', type: 'RETURN_VISIT', status: 'TRIAGED', registeredAt: '2026-01-11T09:00:00.000Z', clinicId: 'test-clinic-001', createdAt: '2026-01-11' },
        { id: 'reg-003', patientId: 'patient-001', doctorId: 'doctor-002', type: 'EMERGENCY', status: 'COMPLETED', registeredAt: '2026-01-12T09:00:00.000Z', clinicId: 'test-clinic-001', createdAt: '2026-01-12' },
        { id: 'reg-004', patientId: 'patient-003', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'CANCELLED', registeredAt: '2026-01-13T09:00:00.000Z', clinicId: 'test-clinic-001', createdAt: '2026-01-13' },
      ]);
    });

    it('不带过滤条件应返回所有挂号', async () => {
      const result = await service.findMany({});

      expect(result.items.length).toBe(4);
      expect(result.total).toBe(4);
    });

    it('按 patientId 过滤应只返回该患者的挂号', async () => {
      const result = await service.findMany({ patientId: 'patient-001' });

      expect(result.items.length).toBe(2);
      result.items.forEach((item: any) => {
        expect(item.patientId).toBe('patient-001');
      });
    });

    it('按 status 过滤应只返回匹配状态的挂号', async () => {
      const result = await service.findMany({ status: 'REGISTERED' });

      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).status).toBe('REGISTERED');
    });

    it('按 startDate 过滤应只返回注册时间大于等于该日期的挂号', async () => {
      const result = await service.findMany({ startDate: '2026-01-12T00:00:00.000Z' });

      expect(result.items.length).toBe(2);
    });

    it('按 endDate 过滤应只返回注册时间小于等于该日期的挂号', async () => {
      const result = await service.findMany({ endDate: '2026-01-11T23:59:59.000Z' });

      expect(result.items.length).toBe(2);
    });

    it('组合过滤（patientId + status）应返回交集', async () => {
      const result = await service.findMany({ patientId: 'patient-001', status: 'COMPLETED' });

      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).id).toBe('reg-003');
    });

    it('分页查询应返回正确的分页信息', async () => {
      const result = await service.findMany({ page: 1, pageSize: 2 });

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(4);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(2);
    });

    it('第二页应返回剩余记录', async () => {
      const result = await service.findMany({ page: 2, pageSize: 2 });

      expect(result.items.length).toBe(2);
      expect(result.page).toBe(2);
    });

    it('使用默认分页参数应正常返回', async () => {
      const result = await service.findMany({});

      expect(result.page).toBe(1);
      expect(result.pageSize).toBeDefined();
    });
  });

  // ==================== findAll ====================

  describe('findAll - 获取所有挂号', () => {
    beforeEach(() => {
      db.seed('Registration', [
        { id: 'reg-001', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'REGISTERED', registeredAt: '2026-01-10', clinicId: 'test-clinic-001', createdAt: '2026-01-10' },
        { id: 'reg-002', patientId: 'patient-002', doctorId: 'doctor-001', type: 'RETURN_VISIT', status: 'REGISTERED', registeredAt: '2026-01-11', clinicId: 'test-clinic-001', createdAt: '2026-01-11' },
      ]);
    });

    it('应返回所有挂号记录', async () => {
      const result = await service.findAll({ page: 1, pageSize: 10 });

      expect(result.total).toBe(2);
      expect(result.items.length).toBe(2);
    });

    it('使用默认分页参数应正常返回', async () => {
      const result = await service.findAll();

      expect(result.items.length).toBe(2);
      expect(result.page).toBe(1);
    });

    it('分页查询应正确', async () => {
      const result = await service.findAll({ page: 1, pageSize: 1 });

      expect(result.items.length).toBe(1);
      expect(result.total).toBe(2);
    });
  });

  // ==================== update ====================

  describe('update - 更新挂号信息', () => {
    beforeEach(() => {
      db.seed('Registration', [
        { id: 'reg-001', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'REGISTERED', chiefComplaint: '初始主诉', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
    });

    it('更新医生和类型应成功', async () => {
      const result = await service.update('reg-001', {
        doctorId: 'doctor-002',
        type: 'RETURN_VISIT',
        chiefComplaint: '更新后的主诉',
      });

      expect((result as any).doctorId).toBe('doctor-002');
      expect((result as any).type).toBe('RETURN_VISIT');
      expect((result as any).chiefComplaint).toBe('更新后的主诉');
    });

    it('只更新部分字段应不影响其他字段', async () => {
      const result = await service.update('reg-001', {
        chiefComplaint: '新主诉',
      });

      expect((result as any).chiefComplaint).toBe('新主诉');
      expect((result as any).doctorId).toBe('doctor-001');
    });

    it('更新不存在的挂号应抛出 NotFoundException', async () => {
      await expect(
        service.update('non-existent', { chiefComplaint: 'test' } as any),
      ).rejects.toThrow(NotFoundException);
    });

    it('包含 id 字段时应跳过 id 更新', async () => {
      const result = await service.update('reg-001', {
        id: 'should-not-change',
        chiefComplaint: '新主诉',
      });

      expect((result as any).id).toBe('reg-001');
    });

    it('包含 createdAt 字段时应跳过 createdAt 更新', async () => {
      const result = await service.update('reg-001', {
        createdAt: '2020-01-01',
        chiefComplaint: '新主诉',
      });

      // createdAt 应保持原值
      expect((result as any).createdAt).toBe('2026-01-01');
    });

    it('undefined 值字段应被跳过', async () => {
      const result = await service.update('reg-001', {
        chiefComplaint: '新主诉',
        doctorId: undefined,
      });

      // doctorId 应保持原值
      expect((result as any).doctorId).toBe('doctor-001');
      expect((result as any).chiefComplaint).toBe('新主诉');
    });

    it('空对象更新应返回原记录', async () => {
      const result = await service.update('reg-001', {});

      expect((result as any).id).toBe('reg-001');
      expect((result as any).chiefComplaint).toBe('初始主诉');
    });

    it('更新 status 字段应成功（update 方法本身不做状态机校验）', async () => {
      const result = await service.update('reg-001', { status: 'TRIAGED' } as any);

      expect((result as any).status).toBe('TRIAGED');
    });
  });

  // ==================== updateStatus ====================

  describe('updateStatus - 通用状态更新', () => {
    beforeEach(() => {
      db.seed('Registration', [
        { id: 'reg-001', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'REGISTERED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-002', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'TRIAGED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-003', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'IN_PROGRESS', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-004', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'COMPLETED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-005', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'CANCELLED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
    });

    // --- 合法流转 ---

    it('REGISTERED → TRIAGED 应成功', async () => {
      const result = await service.updateStatus('reg-001', 'TRIAGED');
      expect((result as any).status).toBe('TRIAGED');
    });

    it('REGISTERED → IN_PROGRESS 应成功', async () => {
      const result = await service.updateStatus('reg-001', 'IN_PROGRESS');
      expect((result as any).status).toBe('IN_PROGRESS');
    });

    it('REGISTERED → CANCELLED 应成功', async () => {
      const result = await service.updateStatus('reg-001', 'CANCELLED');
      expect((result as any).status).toBe('CANCELLED');
    });

    it('TRIAGED → IN_PROGRESS 应成功', async () => {
      const result = await service.updateStatus('reg-002', 'IN_PROGRESS');
      expect((result as any).status).toBe('IN_PROGRESS');
    });

    it('TRIAGED → CANCELLED 应成功', async () => {
      const result = await service.updateStatus('reg-002', 'CANCELLED');
      expect((result as any).status).toBe('CANCELLED');
    });

    it('IN_PROGRESS → COMPLETED 应成功', async () => {
      const result = await service.updateStatus('reg-003', 'COMPLETED');
      expect((result as any).status).toBe('COMPLETED');
    });

    it('IN_PROGRESS → CANCELLED 应成功', async () => {
      const result = await service.updateStatus('reg-003', 'CANCELLED');
      expect((result as any).status).toBe('CANCELLED');
    });

    // --- 非法流转 ---

    it('REGISTERED → COMPLETED 非法流转应抛出 BadRequestException', async () => {
      await expect(service.updateStatus('reg-001', 'COMPLETED')).rejects.toThrow(BadRequestException);
    });

    it('TRIAGED → TRIAGED 非法流转应抛出 BadRequestException', async () => {
      await expect(service.updateStatus('reg-002', 'TRIAGED')).rejects.toThrow(BadRequestException);
    });

    it('TRIAGED → COMPLETED 非法流转应抛出 BadRequestException', async () => {
      await expect(service.updateStatus('reg-002', 'COMPLETED')).rejects.toThrow(BadRequestException);
    });

    it('IN_PROGRESS → REGISTERED 非法流转应抛出 BadRequestException', async () => {
      await expect(service.updateStatus('reg-003', 'REGISTERED')).rejects.toThrow(BadRequestException);
    });

    it('IN_PROGRESS → TRIAGED 非法流转应抛出 BadRequestException', async () => {
      await expect(service.updateStatus('reg-003', 'TRIAGED')).rejects.toThrow(BadRequestException);
    });

    it('COMPLETED → 任何状态非法流转应抛出 BadRequestException', async () => {
      await expect(service.updateStatus('reg-004', 'REGISTERED')).rejects.toThrow(BadRequestException);
      await expect(service.updateStatus('reg-004', 'TRIAGED')).rejects.toThrow(BadRequestException);
      await expect(service.updateStatus('reg-004', 'IN_PROGRESS')).rejects.toThrow(BadRequestException);
      await expect(service.updateStatus('reg-004', 'CANCELLED')).rejects.toThrow(BadRequestException);
    });

    it('CANCELLED → 任何状态非法流转应抛出 BadRequestException', async () => {
      await expect(service.updateStatus('reg-005', 'REGISTERED')).rejects.toThrow(BadRequestException);
      await expect(service.updateStatus('reg-005', 'TRIAGED')).rejects.toThrow(BadRequestException);
      await expect(service.updateStatus('reg-005', 'IN_PROGRESS')).rejects.toThrow(BadRequestException);
      await expect(service.updateStatus('reg-005', 'COMPLETED')).rejects.toThrow(BadRequestException);
    });

    it('更新不存在的挂号状态应抛出异常', async () => {
      await expect(service.updateStatus('non-existent', 'TRIAGED')).rejects.toThrow();
    });
  });

  // ==================== triage ====================

  describe('triage - 分诊', () => {
    beforeEach(() => {
      db.seed('Registration', [
        { id: 'reg-001', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'REGISTERED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-002', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'TRIAGED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
    });

    it('REGISTERED → TRIAGED 应成功并设置分诊信息', async () => {
      const result = await service.triage('reg-001', {
        triageNote: '情况稳定',
        chiefComplaint: '补牙',
      });

      expect((result as any).status).toBe('TRIAGED');
      expect((result as any).triageNote).toBe('情况稳定');
      expect((result as any).chiefComplaint).toBe('补牙');
      expect((result as any).triagedAt).toBeDefined();
    });

    it('分诊不带 triageNote 时 triageNote 应为 null', async () => {
      const result = await service.triage('reg-001', {
        chiefComplaint: '补牙',
      });

      expect((result as any).triageNote).toBeNull();
    });

    it('分诊不带 chiefComplaint 时 chiefComplaint 应为 null', async () => {
      const result = await service.triage('reg-001', {
        triageNote: '情况稳定',
      });

      expect((result as any).chiefComplaint).toBeNull();
    });

    it('空对象分诊时 triageNote 和 chiefComplaint 应为 null', async () => {
      const result = await service.triage('reg-001', {});

      expect((result as any).status).toBe('TRIAGED');
      expect((result as any).triageNote).toBeNull();
      expect((result as any).chiefComplaint).toBeNull();
    });

    it('非 REGISTERED 状态不可分诊应抛出 BadRequestException', async () => {
      await expect(
        service.triage('reg-002', { triageNote: 'test' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('分诊不存在的挂号应抛出异常', async () => {
      await expect(
        service.triage('non-existent', { triageNote: 'test' }),
      ).rejects.toThrow();
    });
  });

  // ==================== startVisit ====================

  describe('startVisit - 开始就诊', () => {
    beforeEach(() => {
      db.seed('Registration', [
        { id: 'reg-001', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'REGISTERED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-002', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'TRIAGED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-003', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'IN_PROGRESS', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-004', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'COMPLETED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-005', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'CANCELLED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
    });

    it('REGISTERED 状态开始就诊应成功并创建 Visit', async () => {
      const result = await service.startVisit('reg-001');

      expect((result as any).status).toBe(RegistrationStatus.IN_PROGRESS);
      expect((result as any).visitId).toBeDefined();
      expect((result as any).startedAt).toBeDefined();
      expect(mockVisitsService.createSync).toHaveBeenCalled();
    });

    it('TRIAGED 状态开始就诊应成功', async () => {
      const result = await service.startVisit('reg-002');

      expect((result as any).status).toBe(RegistrationStatus.IN_PROGRESS);
      expect((result as any).visitId).toBeDefined();
    });

    it('IN_PROGRESS 状态不可开始就诊应抛出 BadRequestException', async () => {
      await expect(service.startVisit('reg-003')).rejects.toThrow(BadRequestException);
    });

    it('COMPLETED 状态不可开始就诊应抛出 BadRequestException', async () => {
      await expect(service.startVisit('reg-004')).rejects.toThrow(BadRequestException);
    });

    it('CANCELLED 状态不可开始就诊应抛出 BadRequestException', async () => {
      await expect(service.startVisit('reg-005')).rejects.toThrow(BadRequestException);
    });

    it('已有关联 visitId 时应幂等返回（不重复创建）', async () => {
      db.seed('Registration', [
        { id: 'reg-idempotent', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'TRIAGED', visitId: 'existing-visit-id', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);

      const result = await service.startVisit('reg-idempotent');

      // 幂等：直接返回，不调用 createSync
      expect(mockVisitsService.createSync).not.toHaveBeenCalled();
      expect((result as any).visitId).toBe('existing-visit-id');
    });

    it('无预约时开始就诊应调用 visitsService.createSync', async () => {
      await service.startVisit('reg-001');

      expect(mockVisitsService.createSync).toHaveBeenCalledTimes(1);
      const callArgs = mockVisitsService.createSync.mock.calls[0][0];
      expect(callArgs.patientId).toBe('patient-001');
    });

    it('有关联预约时应复用已存在的 Visit', async () => {
      db.seed('Registration', [
        { id: 'reg-apt', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'REGISTERED', appointmentId: 'apt-001', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
      db.seed('Visit', [
        { id: 'existing-visit-for-apt', patientId: 'patient-001', appointmentId: 'apt-001', status: 'IN_PROGRESS', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);

      const result = await service.startVisit('reg-apt');

      // 应复用已存在的 Visit，不调用 createSync
      expect(mockVisitsService.createSync).not.toHaveBeenCalled();
      // 应调用 linkVisitSync
      expect(mockAppointmentsService.linkVisitSync).toHaveBeenCalledWith('apt-001', 'existing-visit-for-apt', expect.anything());
      expect((result as any).visitId).toBe('existing-visit-for-apt');
    });

    it('有关联预约但无已存在 Visit 时应创建新 Visit', async () => {
      db.seed('Registration', [
        { id: 'reg-apt-new', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'REGISTERED', appointmentId: 'apt-002', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);

      const result = await service.startVisit('reg-apt-new');

      // 应调用 createSync 创建新 Visit
      expect(mockVisitsService.createSync).toHaveBeenCalledTimes(1);
      // 应调用 linkVisitSync
      expect(mockAppointmentsService.linkVisitSync).toHaveBeenCalledWith('apt-002', 'mock-visit-id', expect.anything());
      expect((result as any).status).toBe(RegistrationStatus.IN_PROGRESS);
    });

    it('开始就诊应写入审计日志', async () => {
      await service.startVisit('reg-001');

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === 'reg-001' && l.type === 'REGISTRATION_START_VISIT');
      expect(log).toBeDefined();
    });

    it('开始就诊不存在的挂号应抛出异常', async () => {
      await expect(service.startVisit('non-existent')).rejects.toThrow();
    });
  });

  // ==================== complete ====================

  describe('complete - 完成就诊', () => {
    beforeEach(() => {
      db.seed('Registration', [
        { id: 'reg-001', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'IN_PROGRESS', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-002', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'REGISTERED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-003', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'COMPLETED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-004', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'CANCELLED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
    });

    it('IN_PROGRESS → COMPLETED 应成功并设置 completedAt', async () => {
      const result = await service.complete('reg-001');

      expect((result as any).status).toBe('COMPLETED');
      expect((result as any).completedAt).toBeDefined();
    });

    it('REGISTERED 不可直接完成应抛出 BadRequestException', async () => {
      await expect(service.complete('reg-002')).rejects.toThrow(BadRequestException);
    });

    it('COMPLETED 是终态不可再完成应抛出 BadRequestException', async () => {
      await expect(service.complete('reg-003')).rejects.toThrow(BadRequestException);
    });

    it('CANCELLED 是终态不可完成应抛出 BadRequestException', async () => {
      await expect(service.complete('reg-004')).rejects.toThrow(BadRequestException);
    });

    it('完成不存在的挂号应抛出异常', async () => {
      await expect(service.complete('non-existent')).rejects.toThrow();
    });
  });

  // ==================== cancel ====================

  describe('cancel - 取消挂号', () => {
    beforeEach(() => {
      db.seed('Registration', [
        { id: 'reg-001', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'REGISTERED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-002', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'TRIAGED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-003', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'IN_PROGRESS', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-004', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'COMPLETED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-005', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'CANCELLED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
      ]);
    });

    it('REGISTERED → CANCELLED 应成功', async () => {
      const result = await service.cancel('reg-001');
      expect((result as any).status).toBe('CANCELLED');
    });

    it('TRIAGED → CANCELLED 应成功', async () => {
      const result = await service.cancel('reg-002');
      expect((result as any).status).toBe('CANCELLED');
    });

    it('IN_PROGRESS → CANCELLED 应成功', async () => {
      const result = await service.cancel('reg-003');
      expect((result as any).status).toBe('CANCELLED');
    });

    it('COMPLETED 不可取消应抛出 BadRequestException', async () => {
      await expect(service.cancel('reg-004')).rejects.toThrow(BadRequestException);
    });

    it('CANCELLED 不可再次取消应抛出 BadRequestException', async () => {
      await expect(service.cancel('reg-005')).rejects.toThrow(BadRequestException);
    });

    it('取消应写入审计日志', async () => {
      await service.cancel('reg-001');

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === 'reg-001' && l.type === 'REGISTRATION_CANCEL');
      expect(log).toBeDefined();
    });

    it('取消不存在的挂号应抛出异常', async () => {
      await expect(service.cancel('non-existent')).rejects.toThrow();
    });
  });

  // ==================== 诊所上下文隔离 ====================

  describe('诊所上下文隔离', () => {
    it('无 clinicId 时应抛出 ForbiddenException（缺少诊所信息）', async () => {
      const crossClinicService = new RegistrationsService(
        db as any,
        createMockClinicContext(null),
        createMockVisitsService(),
        createMockAppointmentsService(),
      );

      await expect(
        crossClinicService.create({
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          type: 'FIRST_VISIT' as any,
        } as any),
      ).rejects.toThrow(ForbiddenException);
    });

    it('不同诊所的挂号应互相隔离', async () => {
      db.seed('Registration', [
        { id: 'reg-clinic1', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'REGISTERED', clinicId: 'test-clinic-001', createdAt: '2026-01-01' },
        { id: 'reg-clinic2', patientId: 'patient-001', doctorId: 'doctor-001', type: 'FIRST_VISIT', status: 'REGISTERED', clinicId: 'other-clinic-002', createdAt: '2026-01-01' },
      ]);

      const result = await service.findMany({ patientId: 'patient-001' });

      // 只应返回当前诊所的挂号
      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).id).toBe('reg-clinic1');
    });
  });
});
