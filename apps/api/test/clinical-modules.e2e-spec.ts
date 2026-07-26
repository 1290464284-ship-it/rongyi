import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@db/db.service';
import { ClinicContextService } from '@common/services/clinic-context.service';
import { IdempotencyService } from '@common/services/idempotency.service';
import {
  createTestDb, cleanupTestDb, createTestDbService, seedTestData, runInClinicContext,
} from '@db/test-helpers';
import { TEST_CLINIC_ID, TEST_PATIENT_ID, TEST_DOCTOR_ID } from './factories';
import { FirstExamsService } from '@modules/clinical/first-exams/first-exams.service';
import { OralExaminationsService } from '@modules/clinical/oral-examinations/oral-examinations.service';
import { PeriodontalRecordsService } from '@modules/clinical/periodontal-records/periodontal-records.service';

describe('Clinical Modules Integration Tests', () => {
  let firstExamsService: FirstExamsService;
  let oralExamsService: OralExaminationsService;
  let perioService: PeriodontalRecordsService;
  let clinicContext: ClinicContextService;
  let db: ReturnType<typeof createTestDb>;
  let module: TestingModule;

  const runAsAdmin = <T>(fn: () => T) =>
    runInClinicContext(clinicContext, { clinicId: TEST_CLINIC_ID, userId: 'admin-001', role: 'ADMIN' }, fn);

  // 直接通过 SQL 插入 FirstExam，绕开 service.create() 设置的 status='PENDING'
  // （PENDING 不在 CHECK 约束允许的 DRAFT/SUBMITTED/APPROVED/CANCELLED 范围内）
  const insertFirstExam = (
    id: string,
    overrides: { status?: string; chiefComplaint?: string; diagnosis?: string } = {},
  ) => {
    const now = new Date().toISOString();
    db.prepare(
      'INSERT INTO FirstExam (id, patientId, doctorId, status, chiefComplaint, diagnosis, clinicId, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)',
    ).run(
      id,
      TEST_PATIENT_ID,
      TEST_DOCTOR_ID,
      overrides.status ?? 'DRAFT',
      overrides.chiefComplaint ?? null,
      overrides.diagnosis ?? null,
      TEST_CLINIC_ID,
      now,
      now,
    );
  };

  beforeEach(async () => {
    db = createTestDb();
    seedTestData(db);
    const testDbService = createTestDbService(db);
    module = await Test.createTestingModule({
      providers: [
        { provide: DbService, useValue: testDbService },
        ClinicContextService, IdempotencyService,
        FirstExamsService, OralExaminationsService, PeriodontalRecordsService,
      ],
    }).compile();
    firstExamsService = module.get(FirstExamsService);
    oralExamsService = module.get(OralExaminationsService);
    perioService = module.get(PeriodontalRecordsService);
    clinicContext = module.get(ClinicContextService);
  });
  afterEach(() => { cleanupTestDb(db); });

  describe('FirstExams', () => {
    it('create() 应以 DRAFT 状态成功创建初诊记录', async () => {
      const result = await runAsAdmin(() =>
        firstExamsService.create({ patientId: TEST_PATIENT_ID, doctorId: TEST_DOCTOR_ID } as any),
      );
      expect(result.id).toBeDefined();
      expect(result.status).toBe('DRAFT');
      expect(result.patientId).toBe(TEST_PATIENT_ID);
    });

    it('应更新初诊的主诉与诊断', async () => {
      const id = 'exam-update-001';
      insertFirstExam(id);
      const result = await runAsAdmin(() =>
        firstExamsService.update(id, { chiefComplaint: '牙痛', diagnosis: '龋齿' } as any),
      );
      expect(result.chiefComplaint).toBe('牙痛');
      expect(result.diagnosis).toBe('龋齿');
    });

    it('应将状态从 DRAFT 更新为 SUBMITTED', async () => {
      const id = 'exam-status-001';
      insertFirstExam(id, { status: 'DRAFT' });
      const result = await runAsAdmin(() => firstExamsService.updateStatus(id, 'SUBMITTED'));
      expect((result as any).status).toBe('SUBMITTED');
    });

    it('complete() 应成功将状态设为 APPROVED', async () => {
      const id = 'exam-complete-001';
      insertFirstExam(id, { status: 'SUBMITTED' });
      const result = await runAsAdmin(() => firstExamsService.complete(id));
      expect((result as any).status).toBe('APPROVED');
    });

    it('应为初诊创建随访记录', async () => {
      const id = 'exam-followup-001';
      insertFirstExam(id);
      const result = await runAsAdmin(() =>
        firstExamsService.createFollowUp(id, {
          planDate: '2026-08-01',
          content: '一周后复诊',
          assigneeId: TEST_DOCTOR_ID,
        } as any),
      );
      expect(result.id).toBeDefined();
      const row = db.prepare('SELECT * FROM FirstExamFollowUp WHERE id = ?').get(result.id) as any;
      expect(row.examId).toBe(id);
      expect(row.content).toBe('一周后复诊');
      expect(row.planDate).toBe('2026-08-01');
      expect(row.assigneeId).toBe(TEST_DOCTOR_ID);
      expect(row.clinicId).toBe(TEST_CLINIC_ID);
    });

    it('stats() 应返回当前诊所的初诊总数', async () => {
      insertFirstExam('exam-stats-001');
      insertFirstExam('exam-stats-002');
      insertFirstExam('exam-stats-003');
      const result = await runAsAdmin(() => firstExamsService.stats());
      expect(result.total).toBe(3);
    });
  });

  describe('OralExaminations', () => {
    it('应创建口腔检查记录', async () => {
      const result = await runAsAdmin(() =>
        oralExamsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          examDate: '2026-07-23',
          caries: [{ toothNumber: 16, surface: 'O' }],
          looseTeeth: [21],
          mucosa: '正常',
          tmj: '正常',
          remark: '常规检查',
        } as any),
      );
      expect(result.id).toBeDefined();
      expect(result.patientId).toBe(TEST_PATIENT_ID);
      expect((result as any).examDate).toBe('2026-07-23');
      expect(result.caries).toEqual([{ toothNumber: 16, surface: 'O' }]);
      expect(result.looseTeeth).toEqual([21]);
      expect(result.remark).toBe('常规检查');
    });

    it('应按患者查询口腔检查记录', async () => {
      await runAsAdmin(() =>
        oralExamsService.create({ patientId: TEST_PATIENT_ID, examDate: '2026-07-23', remark: '第一次' } as any),
      );
      await runAsAdmin(() =>
        oralExamsService.create({ patientId: TEST_PATIENT_ID, examDate: '2026-07-24', remark: '第二次' } as any),
      );
      const result = await runAsAdmin(() => oralExamsService.findByPatient(TEST_PATIENT_ID));
      expect(result.total).toBe(2);
      expect(result.items.length).toBe(2);
      result.items.forEach((item: any) => {
        expect(item.patientId).toBe(TEST_PATIENT_ID);
      });
    });

    it('应分页返回口腔检查列表', async () => {
      for (let i = 0; i < 5; i++) {
        await runAsAdmin(() =>
          oralExamsService.create({ patientId: TEST_PATIENT_ID, examDate: '2026-07-23', remark: `记录${i}` } as any),
        );
      }
      const page1 = await runAsAdmin(() => oralExamsService.findMany({ page: 1, pageSize: 2 }));
      expect(page1.total).toBe(5);
      expect(page1.items.length).toBe(2);
      expect(page1.page).toBe(1);

      const page2 = await runAsAdmin(() => oralExamsService.findMany({ page: 2, pageSize: 2 }));
      expect(page2.items.length).toBe(2);
      expect(page2.page).toBe(2);

      const page3 = await runAsAdmin(() => oralExamsService.findMany({ page: 3, pageSize: 2 }));
      expect(page3.items.length).toBe(1);
    });

    it('应按备注关键词搜索口腔检查记录', async () => {
      await runAsAdmin(() =>
        oralExamsService.create({ patientId: TEST_PATIENT_ID, examDate: '2026-07-23', remark: '龋齿检查' } as any),
      );
      await runAsAdmin(() =>
        oralExamsService.create({ patientId: TEST_PATIENT_ID, examDate: '2026-07-24', remark: '牙周检查' } as any),
      );
      const result = await runAsAdmin(() => oralExamsService.findMany({ keyword: '龋齿' }));
      expect(result.total).toBe(1);
      expect(result.items[0].remark).toBe('龋齿检查');
    });
  });

  describe('PeriodontalRecords', () => {
    it('应创建牙周记录', async () => {
      const result = await runAsAdmin(() =>
        perioService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          examDate: '2026-07-23',
          data: { probingDepth: { '16': 3 }, bleedingIndex: 0.5 },
          remark: '初诊牙周',
        } as any),
      );
      expect(result.id).toBeDefined();
      expect(result.patientId).toBe(TEST_PATIENT_ID);
      expect(result.examDate).toBe('2026-07-23');
      expect(result.data).toEqual({ probingDepth: { '16': 3 }, bleedingIndex: 0.5 });
      expect(result.remark).toBe('初诊牙周');
    });

    it('应按患者查询牙周记录', async () => {
      await runAsAdmin(() =>
        perioService.create({ patientId: TEST_PATIENT_ID, examDate: '2026-07-23', data: { a: 1 } } as any),
      );
      await runAsAdmin(() =>
        perioService.create({ patientId: TEST_PATIENT_ID, examDate: '2026-07-24', data: { b: 2 } } as any),
      );
      const result = await runAsAdmin(() => perioService.findByPatient(TEST_PATIENT_ID));
      expect(result.total).toBe(2);
      expect(result.items.length).toBe(2);
      result.items.forEach((item: any) => {
        expect(item.patientId).toBe(TEST_PATIENT_ID);
      });
    });

    it('应分页返回牙周记录列表', async () => {
      for (let i = 0; i < 4; i++) {
        await runAsAdmin(() =>
          perioService.create({ patientId: TEST_PATIENT_ID, examDate: '2026-07-23', data: { idx: i } } as any),
        );
      }
      const page1 = await runAsAdmin(() => perioService.findMany({ page: 1, pageSize: 2 }));
      expect(page1.total).toBe(4);
      expect(page1.items.length).toBe(2);
      expect(page1.page).toBe(1);

      const page2 = await runAsAdmin(() => perioService.findMany({ page: 2, pageSize: 2 }));
      expect(page2.items.length).toBe(2);
      expect(page2.page).toBe(2);
    });

    it('应更新牙周记录的备注', async () => {
      const created = await runAsAdmin(() =>
        perioService.create({ patientId: TEST_PATIENT_ID, examDate: '2026-07-23', data: {}, remark: '原备注' } as any),
      );
      const result = await runAsAdmin(() =>
        perioService.update(created.id, { remark: '更新后的备注' } as any),
      );
      expect(result.remark).toBe('更新后的备注');
    });
  });
});
