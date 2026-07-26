import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { RegistrationsService } from './registrations.service';
import { VisitsService } from '../visits/visits.service';
import { AppointmentsService } from '../../scheduling/appointments/appointments.service';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import {
  createTestDb,
  cleanupTestDb,
  createTestDbService,
  seedTestData,
  runInClinicContext,
} from '../../../db/test-helpers';
import { RegistrationStatus } from '@dental/shared';
import {
  TEST_CLINIC_ID,
  TEST_PATIENT_ID,
  TEST_DOCTOR_ID,
  createRegistrationFactory,
} from '../../../../test/factories';

describe('RegistrationsService - Integration', () => {
  let service: RegistrationsService;
  let clinicContext: ClinicContextService;
  let db: ReturnType<typeof createTestDb>;
  let module: TestingModule;

  const runAsDoctor = <T>(fn: () => T) =>
    runInClinicContext(
      clinicContext,
      { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
      fn,
    );

  beforeEach(async () => {
    db = createTestDb();
    seedTestData(db);

    // Pre-insert a Visit record so that the mocked VisitsService.createSync
    // ('mock-visit-id') has a corresponding row for FK / SELECT queries.
    db.prepare(
      'INSERT INTO Visit (id, patientId, doctorId, status, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('mock-visit-id', TEST_PATIENT_ID, TEST_DOCTOR_ID, 'IN_PROGRESS', TEST_CLINIC_ID, new Date().toISOString());

    const testDbService = createTestDbService(db);

    module = await Test.createTestingModule({
      providers: [
        { provide: DbService, useValue: testDbService },
        ClinicContextService,
        {
          provide: VisitsService,
          useValue: {
            createSync: jest.fn().mockReturnValue('mock-visit-id'),
            create: jest.fn().mockResolvedValue({ id: 'mock-visit-id' }),
          },
        },
        {
          provide: AppointmentsService,
          useValue: {
            linkVisitSync: jest.fn(),
            linkVisit: jest.fn(),
          },
        },
        RegistrationsService,
      ],
    }).compile();

    service = module.get(RegistrationsService);
    clinicContext = module.get(ClinicContextService);
  });

  afterEach(() => {
    cleanupTestDb(db);
  });

  describe('create - 创建挂号', () => {
    it('应成功创建初诊挂号', async () => {
      const result = await runAsDoctor(() =>
        service.create(createRegistrationFactory({ type: 'FIRST_VISIT', chiefComplaint: '牙痛' }))
      );

      expect(result.id).toBeDefined();
      expect(result.patientId).toBe(TEST_PATIENT_ID);
      expect(result.doctorId).toBe(TEST_DOCTOR_ID);
      expect(result.type).toBe('FIRST_VISIT');
      expect(result.status).toBe(RegistrationStatus.REGISTERED);
      expect(result.chiefComplaint).toBe('牙痛');
      expect(result.registeredAt).toBeDefined();
      expect(result.createdAt).toBeDefined();
    });

    it('应成功创建复诊挂号', async () => {
      const result = await runAsDoctor(() =>
        service.create(createRegistrationFactory({ type: 'RETURN_VISIT' }))
      );

      expect(result.id).toBeDefined();
      expect(result.type).toBe('RETURN_VISIT');
      expect(result.status).toBe(RegistrationStatus.REGISTERED);
    });

    it('应成功创建急诊挂号', async () => {
      const result = await runAsDoctor(() =>
        service.create(createRegistrationFactory({ type: 'EMERGENCY', chiefComplaint: '外伤' }))
      );

      expect(result.id).toBeDefined();
      expect(result.type).toBe('EMERGENCY');
      expect(result.status).toBe(RegistrationStatus.REGISTERED);
    });

    it('创建的挂号应有 clinicId', async () => {
      const result = await runAsDoctor(() =>
        service.create(createRegistrationFactory())
      );

      const record = db.prepare("SELECT clinicId FROM Registration WHERE id = ?").get(result.id) as any;
      expect(record.clinicId).toBe(TEST_CLINIC_ID);
    });
  });

  describe('findOne - 获取挂号详情', () => {
    it('应返回挂号详情', async () => {
      const created = await runAsDoctor(() =>
        service.create(createRegistrationFactory({ chiefComplaint: '牙痛' }))
      );

      const result = await runAsDoctor(() => service.findOne(created.id));

      expect(result.id).toBe(created.id);
      expect(result.patientId).toBe(TEST_PATIENT_ID);
      expect(result.doctorId).toBe(TEST_DOCTOR_ID);
      expect(result.type).toBe('FIRST_VISIT');
      expect(result.status).toBe(RegistrationStatus.REGISTERED);
    });

    it('挂号不存在应抛出 NotFoundException', async () => {
      await expect(runAsDoctor(() => service.findOne('non-existent'))).rejects.toThrow(NotFoundException);
    });
  });

  describe('状态流转 - 分诊', () => {
    it('REGISTERED -> TRIAGED 应成功', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      const result = await runAsDoctor(() =>
        service.triage(created.id, {
          triageNote: '患者情况稳定',
          chiefComplaint: '补牙',
        })
      );

      expect(result.status).toBe(RegistrationStatus.TRIAGED);
      expect(result.triageNote).toBe('患者情况稳定');
      expect(result.chiefComplaint).toBe('补牙');
      expect(result.triagedAt).toBeDefined();
    });

    it('非 REGISTERED 状态不可分诊', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      await runAsDoctor(() => service.triage(created.id, {}));

      await expect(runAsDoctor(() => service.triage(created.id, {}))).rejects.toThrow(BadRequestException);
    });
  });

  describe('状态流转 - 开始就诊', () => {
    it('REGISTERED -> IN_PROGRESS 应成功并创建 Visit', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      const result = await runAsDoctor(() => service.startVisit(created.id));

      expect(result.status).toBe(RegistrationStatus.IN_PROGRESS);
      expect(result.visitId).toBeDefined();
      expect(result.startedAt).toBeDefined();

      const visit = db.prepare("SELECT * FROM Visit WHERE id = ?").get(result.visitId) as any;
      expect(visit).toBeDefined();
      expect(visit.patientId).toBe(TEST_PATIENT_ID);
      expect(visit.doctorId).toBe(TEST_DOCTOR_ID);
      expect(visit.status).toBe('IN_PROGRESS');
    });

    it('TRIAGED -> IN_PROGRESS 应成功', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      await runAsDoctor(() => service.triage(created.id, {}));

      const result = await runAsDoctor(() => service.startVisit(created.id));

      expect(result.status).toBe(RegistrationStatus.IN_PROGRESS);
      expect(result.visitId).toBeDefined();
    });

    it('IN_PROGRESS 状态再次调用 startVisit 应抛出 BadRequestException', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      await runAsDoctor(() => service.startVisit(created.id));

      await expect(runAsDoctor(() => service.startVisit(created.id))).rejects.toThrow(BadRequestException);

      const visitCount = db.prepare("SELECT COUNT(*) as count FROM Visit").get() as { count: number };
      expect(visitCount.count).toBe(1);
    });

    it('COMPLETED 状态不可开始就诊', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      await runAsDoctor(() => service.startVisit(created.id));
      await runAsDoctor(() => service.complete(created.id));

      await expect(runAsDoctor(() => service.startVisit(created.id))).rejects.toThrow(BadRequestException);
    });
  });

  describe('状态流转 - 完成就诊', () => {
    it('IN_PROGRESS -> COMPLETED 应成功', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      await runAsDoctor(() => service.startVisit(created.id));

      const result = await runAsDoctor(() => service.complete(created.id));

      expect(result.status).toBe(RegistrationStatus.COMPLETED);
      expect(result.completedAt).toBeDefined();
    });

    it('REGISTERED 不可直接完成', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      await expect(runAsDoctor(() => service.complete(created.id))).rejects.toThrow(BadRequestException);
    });

    it('COMPLETED 是终态，不可再变更', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      await runAsDoctor(() => service.startVisit(created.id));
      await runAsDoctor(() => service.complete(created.id));

      await expect(runAsDoctor(() => service.cancel(created.id))).rejects.toThrow(BadRequestException);
    });
  });

  describe('状态流转 - 取消挂号', () => {
    it('REGISTERED -> CANCELLED 应成功', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      const result = await runAsDoctor(() => service.cancel(created.id));

      expect(result.status).toBe(RegistrationStatus.CANCELLED);
    });

    it('TRIAGED -> CANCELLED 应成功', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      await runAsDoctor(() => service.triage(created.id, {}));

      const result = await runAsDoctor(() => service.cancel(created.id));

      expect(result.status).toBe(RegistrationStatus.CANCELLED);
    });

    it('IN_PROGRESS -> CANCELLED 应成功', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      await runAsDoctor(() => service.startVisit(created.id));

      const result = await runAsDoctor(() => service.cancel(created.id));

      expect(result.status).toBe(RegistrationStatus.CANCELLED);
    });

    it('CANCELLED 是终态，不可再变更', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      await runAsDoctor(() => service.cancel(created.id));

      await expect(runAsDoctor(() => service.triage(created.id, {}))).rejects.toThrow(BadRequestException);
    });
  });

  describe('updateStatus - 通用状态更新', () => {
    it('应按照状态机正确流转', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      const result = await runAsDoctor(() => service.updateStatus(created.id, 'TRIAGED'));

      expect(result.status).toBe('TRIAGED');
    });

    it('非法状态流转应抛出 BadRequestException', async () => {
      const created = await runAsDoctor(() => service.create(createRegistrationFactory()));

      await expect(runAsDoctor(() => service.updateStatus(created.id, 'COMPLETED'))).rejects.toThrow(BadRequestException);
    });
  });

  describe('findMany - 挂号列表查询', () => {
    beforeEach(async () => {
      await runAsDoctor(() =>
        service.create(createRegistrationFactory({ type: 'FIRST_VISIT', chiefComplaint: '牙痛' }))
      );
      await runAsDoctor(() =>
        service.create(createRegistrationFactory({ type: 'RETURN_VISIT', chiefComplaint: '复诊' }))
      );
      const third = await runAsDoctor(() =>
        service.create(createRegistrationFactory({ type: 'EMERGENCY', chiefComplaint: '急诊' }))
      );
      await runAsDoctor(() => service.cancel(third.id));
    });

    it('应返回分页列表', async () => {
      const result = await runAsDoctor(() => service.findMany({ page: 1, pageSize: 10 }));

      expect(result.total).toBe(3);
      expect(result.items.length).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(10);
    });

    it('按状态过滤 - REGISTERED', async () => {
      const result = await runAsDoctor(() =>
        service.findMany({ status: RegistrationStatus.REGISTERED })
      );

      expect(result.total).toBe(2);
      expect(result.items.length).toBe(2);
      result.items.forEach((item: any) => {
        expect(item.status).toBe(RegistrationStatus.REGISTERED);
      });
    });

    it('按状态过滤 - CANCELLED', async () => {
      const result = await runAsDoctor(() =>
        service.findMany({ status: RegistrationStatus.CANCELLED })
      );

      expect(result.total).toBe(1);
      expect(result.items.length).toBe(1);
      expect(result.items[0].status).toBe(RegistrationStatus.CANCELLED);
    });

    it('按患者过滤', async () => {
      const result = await runAsDoctor(() => service.findMany({ patientId: TEST_PATIENT_ID }));

      expect(result.total).toBe(3);
      result.items.forEach((item: any) => {
        expect(item.patientId).toBe(TEST_PATIENT_ID);
      });
    });

    it('分页功能应正确', async () => {
      const page1 = await runAsDoctor(() => service.findMany({ page: 1, pageSize: 2 }));

      expect(page1.items.length).toBe(2);
      expect(page1.total).toBe(3);
      expect(page1.page).toBe(1);

      const page2 = await runAsDoctor(() => service.findMany({ page: 2, pageSize: 2 }));

      expect(page2.items.length).toBe(1);
      expect(page2.page).toBe(2);
    });
  });

  describe('findAll - 获取所有挂号', () => {
    it('应返回所有挂号记录', async () => {
      await runAsDoctor(() => service.create(createRegistrationFactory({ type: 'FIRST_VISIT' })));
      await runAsDoctor(() => service.create(createRegistrationFactory({ type: 'RETURN_VISIT' })));

      const result = await runAsDoctor(() => service.findAll({ page: 1, pageSize: 10 }));

      expect(result.total).toBe(2);
      expect(result.items.length).toBe(2);
    });
  });

  describe('update - 更新挂号信息', () => {
    it('应更新医生、类型和主诉', async () => {
      const created = await runAsDoctor(() =>
        service.create(createRegistrationFactory({ chiefComplaint: '初始主诉' }))
      );

      const result = await runAsDoctor(() =>
        service.update(created.id, {
          doctorId: TEST_DOCTOR_ID,
          type: 'RETURN_VISIT',
          chiefComplaint: '更新后的主诉',
        })
      );

      expect(result.doctorId).toBe(TEST_DOCTOR_ID);
      expect(result.type).toBe('RETURN_VISIT');
      expect(result.chiefComplaint).toBe('更新后的主诉');
    });

    it('只更新部分字段', async () => {
      const created = await runAsDoctor(() =>
        service.create(createRegistrationFactory({ chiefComplaint: '牙痛' }))
      );

      const result = await runAsDoctor(() =>
        service.update(created.id, {
          chiefComplaint: '新的主诉',
        })
      );

      expect(result.chiefComplaint).toBe('新的主诉');
      expect(result.doctorId).toBe(TEST_DOCTOR_ID);
      expect(result.type).toBe('FIRST_VISIT');
    });
  });
});
