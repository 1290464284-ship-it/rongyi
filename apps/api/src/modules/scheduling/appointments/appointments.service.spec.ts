import { AppointmentsService } from './appointments.service';
import { BusinessValidationException } from '@common/errors';
import { MockDbService } from '../../../db/__mocks__/db-service.mock';
import { asDbService } from '../../../db/__mocks__/db-service.mock';
import { ClinicContextService } from '../../../common/services/clinic-context.service';

import { EventBusService } from '../../../common/events/event-bus.service';

// 构造 ClinicContextService 的 mock，模拟诊所上下文
function createMockClinicContext(): ClinicContextService {
  return {
    getClinicId: () => 'test-clinic-001',
    getUserId: () => 'test-user',
    getRole: () => 'DOCTOR',
    getUserAgent: () => 'jest-test-agent',
    getSource: () => 'test',
    run: <T>(_ctx: unknown, fn: () => T) => fn(),
    isInitialized: () => true,
  } as unknown as ClinicContextService;
}

function createMockEventBus(): jest.Mocked<EventBusService> {
  return {
    emit: jest.fn(),
    on: jest.fn(),
    onAll: jest.fn(),
  } as unknown as jest.Mocked<EventBusService>;
}

describe('AppointmentsService', () => {
  let service: AppointmentsService;
  let db: MockDbService;
  let eventBus: jest.Mocked<EventBusService>;

  beforeEach(() => {
    db = new MockDbService();
    eventBus = createMockEventBus();
    service = new AppointmentsService(asDbService(db), createMockClinicContext(), eventBus);
  });

  afterEach(() => {
    db.clear();
  });

  // ==================== create ====================

  describe('create - 创建预约', () => {
    it('正常创建预约应返回 BOOKED 状态及各项字段', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        startTime: '2026-01-15T09:00:00.000Z',
        endTime: '2026-01-15T10:00:00.000Z',
        type: 'EXAM',
        remark: '初诊检查',
      } as any);

      expect(result).toBeDefined();
      expect(result.patientId).toBe('patient-001');
      expect(result.doctorId).toBe('doctor-001');
      expect(result.type).toBe('EXAM');
      expect(result.status).toBe('BOOKED');
      expect(result.remark).toBe('初诊检查');
      expect(result.id).toBeDefined();
    });

    it('缺少必填字段（doctorId）应抛出 BusinessValidationException', async () => {
      await expect(
        service.create({
          patientId: 'patient-001',
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
        } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('缺少必填字段（patientId）应抛出 BusinessValidationException', async () => {
      await expect(
        service.create({
          doctorId: 'doctor-001',
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
        } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('缺少必填字段（startTime）应抛出 BusinessValidationException', async () => {
      await expect(
        service.create({
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
        } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('缺少必填字段（type）应抛出 BusinessValidationException', async () => {
      await expect(
        service.create({
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
        } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('结束时间早于开始时间应抛出 BusinessValidationException', async () => {
      await expect(
        service.create({
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          startTime: '2026-01-15T10:00:00.000Z',
          endTime: '2026-01-15T09:00:00.000Z',
          type: 'EXAM',
        } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('结束时间等于开始时间应抛出 BusinessValidationException', async () => {
      await expect(
        service.create({
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T09:00:00.000Z',
          type: 'EXAM',
        } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('创建预约时应包含 clinicId', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        startTime: '2026-01-15T09:00:00.000Z',
        endTime: '2026-01-15T10:00:00.000Z',
        type: 'EXAM',
      } as any);

      expect(result.clinicId).toBe('test-clinic-001');
    });

    it('创建预约时应写入审计日志', async () => {
      const result = await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        startTime: '2026-01-15T09:00:00.000Z',
        endTime: '2026-01-15T10:00:00.000Z',
        type: 'EXAM',
      } as any);

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === result.id && l.type === 'APPOINTMENT_CREATE');
      expect(log).toBeDefined();
    });

    it('同一医生时间重叠应抛出 BusinessValidationException', async () => {
      await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        startTime: '2026-01-15T09:00:00.000Z',
        endTime: '2026-01-15T10:00:00.000Z',
        type: 'EXAM',
      } as any);

      await expect(
        service.create({
          patientId: 'patient-002',
          doctorId: 'doctor-001',
          startTime: '2026-01-15T09:30:00.000Z',
          endTime: '2026-01-15T10:30:00.000Z',
          type: 'TREATMENT',
        } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('同一患者时间重叠应抛出 BusinessValidationException', async () => {
      await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        startTime: '2026-01-15T09:00:00.000Z',
        endTime: '2026-01-15T10:00:00.000Z',
        type: 'EXAM',
      } as any);

      await expect(
        service.create({
          patientId: 'patient-001',
          doctorId: 'doctor-002',
          startTime: '2026-01-15T09:30:00.000Z',
          endTime: '2026-01-15T10:30:00.000Z',
          type: 'TREATMENT',
        } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('同一牙椅时间重叠应抛出 BusinessValidationException', async () => {
      await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        chairId: 'chair-001',
        startTime: '2026-01-15T09:00:00.000Z',
        endTime: '2026-01-15T10:00:00.000Z',
        type: 'EXAM',
      } as any);

      await expect(
        service.create({
          patientId: 'patient-002',
          doctorId: 'doctor-002',
          chairId: 'chair-001',
          startTime: '2026-01-15T09:30:00.000Z',
          endTime: '2026-01-15T10:30:00.000Z',
          type: 'TREATMENT',
        } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('不同医生不同时间应成功创建', async () => {
      await service.create({
        patientId: 'patient-001',
        doctorId: 'doctor-001',
        startTime: '2026-01-15T09:00:00.000Z',
        endTime: '2026-01-15T10:00:00.000Z',
        type: 'EXAM',
      } as any);

      const result = await service.create({
        patientId: 'patient-002',
        doctorId: 'doctor-002',
        startTime: '2026-01-15T09:00:00.000Z',
        endTime: '2026-01-15T10:00:00.000Z',
        type: 'EXAM',
      } as any);

      expect(result.doctorId).toBe('doctor-002');
    });
  });

  // ==================== update ====================

  describe('update - 更新预约', () => {
    it('合法状态流转 BOOKED → ARRIVED 应成功', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'BOOKED',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('apt-001', { status: 'ARRIVED' } as any);

      expect(result.status).toBe('ARRIVED');
    });

    it('合法状态流转 BOOKED → CANCELLED 应成功', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'BOOKED',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('apt-001', { status: 'CANCELLED' } as any);

      expect(result.status).toBe('CANCELLED');
    });

    it('合法状态流转 BOOKED → NO_SHOW 应成功', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'BOOKED',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('apt-001', { status: 'NO_SHOW' } as any);

      expect(result.status).toBe('NO_SHOW');
    });

    it('合法状态流转 ARRIVED → IN_CHAIR 应成功', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'ARRIVED',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('apt-001', { status: 'IN_CHAIR' } as any);

      expect(result.status).toBe('IN_CHAIR');
    });

    it('合法状态流转 ARRIVED → CANCELLED 应成功', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'ARRIVED',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('apt-001', { status: 'CANCELLED' } as any);

      expect(result.status).toBe('CANCELLED');
    });

    it('合法状态流转 ARRIVED → NO_SHOW 应成功', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'ARRIVED',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('apt-001', { status: 'NO_SHOW' } as any);

      expect(result.status).toBe('NO_SHOW');
    });

    it('合法状态流转 IN_CHAIR → COMPLETED 应成功', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'IN_CHAIR',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('apt-001', { status: 'COMPLETED' } as any);

      expect(result.status).toBe('COMPLETED');
    });

    it('合法状态流转 IN_CHAIR → CANCELLED 应成功', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'IN_CHAIR',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('apt-001', { status: 'CANCELLED' } as any);

      expect(result.status).toBe('CANCELLED');
    });

    it('非法状态流转 BOOKED → COMPLETED 应抛出 BusinessValidationException', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-002',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'BOOKED',
          clinicId: 'test-clinic-001',
        },
      ]);

      await expect(
        service.update('apt-002', { status: 'COMPLETED' } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('COMPLETED 是终态，不应流转到任何状态', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'COMPLETED',
          clinicId: 'test-clinic-001',
        },
      ]);

      await expect(
        service.update('apt-001', { status: 'BOOKED' } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('CANCELLED 是终态，不应流转到任何状态', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'CANCELLED',
          clinicId: 'test-clinic-001',
        },
      ]);

      await expect(
        service.update('apt-001', { status: 'ARRIVED' } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('NO_SHOW 是终态，不应流转到任何状态', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'NO_SHOW',
          clinicId: 'test-clinic-001',
        },
      ]);

      await expect(
        service.update('apt-001', { status: 'BOOKED' } as any),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('更新预约类型应成功', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'BOOKED',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('apt-001', { type: 'TREATMENT' } as any);

      expect(result.type).toBe('TREATMENT');
    });

    it('更新备注应成功', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'BOOKED',
          remark: '初始备注',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.update('apt-001', { remark: '更新备注' });

      expect(result.remark).toBe('更新备注');
    });

    it('更新不存在的预约应抛出异常', async () => {
      await expect(
        service.update('non-existent', { status: 'ARRIVED' } as any),
      ).rejects.toThrow();
    });

    it('更新预约应写入审计日志', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'BOOKED',
          clinicId: 'test-clinic-001',
        },
      ]);

      await service.update('apt-001', { status: 'ARRIVED' } as any);

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === 'apt-001' && l.type === 'APPOINTMENT_UPDATE');
      expect(log).toBeDefined();
    });

    it('更新结束时间早于开始时间应抛出 BusinessValidationException', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'BOOKED',
          clinicId: 'test-clinic-001',
        },
      ]);

      await expect(
        service.update('apt-001', {
          startTime: '2026-01-15T11:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
        } as any),
      ).rejects.toThrow(BusinessValidationException);
    });
  });

  // ==================== remove ====================

  describe('remove - 删除预约', () => {
    it('删除存在的预约应成功', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'BOOKED',
          clinicId: 'test-clinic-001',
        },
      ]);

      await service.remove('apt-001');

      const rows = db.getTableData('Appointment');
      const deleted = rows.find(r => r.id === 'apt-001');
      expect(deleted).toBeDefined();
      expect(deleted!.deletedAt).toBeTruthy();
    });

    it('删除预约应写入审计日志', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'BOOKED',
          clinicId: 'test-clinic-001',
        },
      ]);

      await service.remove('apt-001');

      const auditLogs = db.getTableData('AuditLog');
      const log = auditLogs.find(l => l.targetId === 'apt-001' && l.type === 'APPOINTMENT_REMOVE');
      expect(log).toBeDefined();
    });

    it('删除不存在的预约应抛出异常', async () => {
      await expect(service.remove('non-existent')).rejects.toThrow();
    });
  });

  // ==================== linkVisit ====================

  describe('linkVisit - 关联就诊', () => {
    it('关联就诊应更新 visitId', async () => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'BOOKED',
          clinicId: 'test-clinic-001',
        },
      ]);

      const result = await service.linkVisit('apt-001', 'visit-001');

      expect(result.visitId).toBe('visit-001');
    });
  });

  // ==================== queryAppointments ====================

  describe('queryAppointments - 查询预约', () => {
    beforeEach(() => {
      db.seed('Appointment', [
        {
          id: 'apt-001',
          patientId: 'patient-001',
          doctorId: 'doctor-001',
          chairId: null,
          startTime: '2026-01-15T09:00:00.000Z',
          endTime: '2026-01-15T10:00:00.000Z',
          type: 'EXAM',
          status: 'BOOKED',
          clinicId: 'test-clinic-001',
        },
        {
          id: 'apt-002',
          patientId: 'patient-002',
          doctorId: 'doctor-002',
          chairId: null,
          startTime: '2026-01-16T09:00:00.000Z',
          endTime: '2026-01-16T10:00:00.000Z',
          type: 'TREATMENT',
          status: 'COMPLETED',
          clinicId: 'test-clinic-001',
        },
      ]);
    });

    it('按医生查询应只返回该医生的预约', async () => {
      const result = await service.queryAppointments({ doctorId: 'doctor-001' });

      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).doctorId).toBe('doctor-001');
    });

    it('按患者查询应只返回该患者的预约', async () => {
      const result = await service.queryAppointments({ patientId: 'patient-002' });

      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).patientId).toBe('patient-002');
    });

    it('按状态过滤应只返回匹配状态的预约', async () => {
      const result = await service.queryAppointments({ status: 'COMPLETED' });

      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).status).toBe('COMPLETED');
    });

    it('按日期范围查询应只返回区间内的预约', async () => {
      const result = await service.queryAppointments({
        startDate: '2026-01-15',
        endDate: '2026-01-15',
      });

      expect(result.items.length).toBe(1);
      expect((result.items[0] as any).id).toBe('apt-001');
    });

    it('分页查询应返回正确的分页信息', async () => {
      const result = await service.queryAppointments({ page: 1, pageSize: 10 });

      expect(result.items.length).toBe(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
    });

    it('空结果应返回空数组', async () => {
      const result = await service.queryAppointments({ doctorId: 'doctor-999' });

      expect(result.items.length).toBe(0);
      expect(result.total).toBe(0);
    });
  });
});
