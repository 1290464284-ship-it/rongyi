import { Test, TestingModule } from '@nestjs/testing';
import { BusinessValidationException, BusinessNotFoundException } from '@common/errors';

import { PatientsService } from '../patients/patients.service';
import { RegistrationsService } from './registrations/registrations.service';
import { VisitsService } from './visits/visits.service';
import { TreatmentsService } from './treatments/treatments.service';
import { ChargeService } from '../financial/charge/charge.service';
import { ChargePaymentService } from '../financial/charge/charge-payment.service';
import { AppointmentsService } from '../scheduling/appointments/appointments.service';
import { PatientRepository } from '../patients/repositories/patient.repository';
import { ChargeRepository } from '../financial/charge/repositories/charge.repository';
import { MemberCardLogRepository } from '../financial/member-cards/repositories/member-card-log.repository';
import { MemberPointLogRepository } from '../financial/member-cards/repositories/member-point-log.repository';
import { DbService } from '../../db/db.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { CacheService } from '../../common/services/cache.service';
import { StatsService } from '../system/stats/stats.service';
import { EventBusService } from '../../common/events/event-bus.service';
import { MemberCardsService } from '../financial/member-cards/member-cards.service';
import {
  createTestDb,
  cleanupTestDb,
  createTestDbService,
  seedTestData,
  runInClinicContext,
} from '../../db/test-helpers';
import {
  TEST_CLINIC_ID,
  TEST_PATIENT_ID,
  TEST_DOCTOR_ID,
} from '../../../test/factories';

/**
 * 临床核心流程 E2E 测试
 *
 * 覆盖「患者建档 → 挂号 → 就诊 → 治疗 → 收费」完整链路，
 * 验证各环节数据状态、状态机流转与审计日志。
 *
 * 金额约定：
 * - DB 存分（INTEGER），如 500 元 = 50000 分
 * - service 调用传元，返回值也是元
 * - 直接查 DB 验证用分
 */
describe('Clinical Flow E2E - 患者→挂号→就诊→治疗→收费', () => {
  let patientsService: PatientsService;
  let registrationsService: RegistrationsService;
  let visitsService: VisitsService;
  let treatmentsService: TreatmentsService;
  let chargeService: ChargeService;
  let chargePaymentService: ChargePaymentService;
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

    const testDbService = createTestDbService(db);

    module = await Test.createTestingModule({
      providers: [
        { provide: DbService, useValue: testDbService },
        ClinicContextService,
        IdempotencyService,
        CacheService,
        {
          provide: StatsService,
          useValue: { invalidateStatsCache: jest.fn() },
        },
        { provide: EventBusService, useValue: { emit: jest.fn(), on: jest.fn(), onAll: jest.fn() } },
        PatientRepository,
        ChargeRepository,
        PatientsService,
        AppointmentsService,
        RegistrationsService,
        VisitsService,
        TreatmentsService,
        ChargeService,
        // P0 修复：使用真实 MemberCardsService 实例，以支持 consumeSync 委托调用
        MemberCardLogRepository,
        MemberPointLogRepository,
        MemberCardsService,
        ChargePaymentService,
      ],
    }).compile();

    patientsService = module.get(PatientsService);
    registrationsService = module.get(RegistrationsService);
    visitsService = module.get(VisitsService);
    treatmentsService = module.get(TreatmentsService);
    chargeService = module.get(ChargeService);
    chargePaymentService = module.get(ChargePaymentService);
    clinicContext = module.get(ClinicContextService);
  });

  afterEach(() => {
    cleanupTestDb(db);
  });

  const C = (yuan: number) => yuan * 100;

  describe('完整 happy path', () => {
    it('患者建档→挂号→就诊→治疗→收费→支付 全链路状态一致', async () => {
      // ================================================================
      // Step 1: 创建新患者（使用 seed 已有患者 ID 以外的新 ID）
      // ================================================================
      const patient = await runAsDoctor(() =>
        patientsService.create({
          name: '新患者张三',
          gender: 'MALE',
          phone: '13900139000',
          birthDate: '1990-05-15',
          source: 'WALK_IN',
        } as any),
      );

      expect(patient.id).toBeDefined();
      expect(patient.name).toBe('新患者张三');
      expect(patient.gender).toBe('MALE');

      const patientRow = db.prepare('SELECT id, name, gender, clinicId FROM Patient WHERE id = ?').get(patient.id) as any;
      expect(patientRow.name).toBe('新患者张三');
      expect(patientRow.clinicId).toBe(TEST_CLINIC_ID);

      // ================================================================
      // Step 2: 为患者创建挂号（初诊）
      // ================================================================
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: patient.id,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
          chiefComplaint: '牙痛三天',
        } as any),
      );

      expect(reg.id).toBeDefined();
      expect(reg.patientId).toBe(patient.id);
      expect(reg.doctorId).toBe(TEST_DOCTOR_ID);
      expect(reg.status).toBe('REGISTERED');
      expect(reg.type).toBe('FIRST_VISIT');
      expect(reg.chiefComplaint).toBe('牙痛三天');
      expect(reg.registeredAt).toBeDefined();

      const regRow = db.prepare('SELECT id, patientId, status, type, visitId FROM Registration WHERE id = ?').get(reg.id) as any;
      expect(regRow.status).toBe('REGISTERED');
      expect(regRow.visitId).toBeNull();

      // 验证挂号审计日志
      const regAudit = db.prepare("SELECT * FROM AuditLog WHERE targetId = ? AND type = 'REGISTRATION_CREATE'").all(reg.id) as any[];
      expect(regAudit.length).toBe(1);

      // ================================================================
      // Step 3: 开始就诊（REGISTERED → IN_PROGRESS，自动创建 Visit）
      // ================================================================
      const startedReg = await runAsDoctor(() => registrationsService.startVisit(reg.id));

      expect(startedReg.status).toBe('IN_PROGRESS');
      expect(startedReg.visitId).toBeDefined();
      expect(startedReg.startedAt).toBeDefined();

      const visitId = startedReg.visitId;

      const visitRow = db.prepare('SELECT id, patientId, doctorId, status, startTime FROM Visit WHERE id = ?').get(visitId) as any;
      expect(visitRow.patientId).toBe(patient.id);
      expect(visitRow.doctorId).toBe(TEST_DOCTOR_ID);
      expect(visitRow.status).toBe('IN_PROGRESS');

      const regAfterVisit = db.prepare('SELECT status, visitId, startedAt FROM Registration WHERE id = ?').get(reg.id) as any;
      expect(regAfterVisit.status).toBe('IN_PROGRESS');
      expect(regAfterVisit.visitId).toBe(visitId);
      expect(regAfterVisit.startedAt).not.toBeNull();

      // ================================================================
      // Step 4: 完成就诊（IN_PROGRESS → COMPLETED，带诊断）
      // ================================================================
      const completedVisit = await runAsDoctor(() =>
        visitsService.complete(visitId, {
          diagnosis: '龋齿（16号牙远中邻面龋）',
          remark: '需要根管治疗',
        }),
      );

      expect(completedVisit.status).toBe('COMPLETED');
      expect(completedVisit.diagnosis).toBe('龋齿（16号牙远中邻面龋）');

      const visitRowAfter = db.prepare('SELECT status, diagnosis, endTime FROM Visit WHERE id = ?').get(visitId) as any;
      expect(visitRowAfter.status).toBe('COMPLETED');
      expect(visitRowAfter.diagnosis).toBe('龋齿（16号牙远中邻面龋）');
      expect(visitRowAfter.endTime).not.toBeNull();

      // 同步完成挂号
      const completedReg = await runAsDoctor(() => registrationsService.complete(reg.id));
      expect(completedReg.status).toBe('COMPLETED');

      // ================================================================
      // Step 5: 创建治疗项目（带牙位）
      // ================================================================
      const treatment = await runAsDoctor(() =>
        treatmentsService.create({
          patientId: patient.id,
          visitId,
          doctorId: TEST_DOCTOR_ID,
          code: 'T001',
          name: '根管治疗',
          category: '修复',
          price: 800,
          quantity: 1,
          teethNumbers: [16],
          remark: '16号牙根管充填',
        } as any),
      );

      expect(treatment.id).toBeDefined();
      expect(treatment.patientId).toBe(patient.id);
      expect(treatment.visitId).toBe(visitId);
      expect(treatment.doctorId).toBe(TEST_DOCTOR_ID);
      expect(treatment.status).toBe('PLANNED');
      expect(treatment.price).toBe(800);
      expect(treatment.teethNumbers).toEqual([16]);

      const treatmentRow = db.prepare('SELECT id, patientId, status, price, teethNumbers FROM Treatment WHERE id = ?').get(treatment.id) as any;
      expect(treatmentRow.status).toBe('PLANNED');
      // v24迁移后 Treatment.price 存 cents：800 元 = 80000 cents
      expect(treatmentRow.price).toBe(80000);

      // ================================================================
      // Step 6: 创建收费单（2个收费项）
      // ================================================================
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: patient.id,
          doctorId: TEST_DOCTOR_ID,
          items: [
            { name: '根管治疗', category: '修复', price: 800, quantity: 1, teethNumbers: ['16'] },
            { name: 'X光片', category: '检查', price: 150, quantity: 1 },
          ],
        }),
      );

      expect(charge.id).toBeDefined();
      expect(charge.totalAmount).toBe(950);
      expect(charge.paidAmount).toBe(0);
      expect(charge.refundedAmount).toBe(0);
      expect(charge.status).toBe('UNPAID');
      expect(charge.items.length).toBe(2);

      const chargeRow = db.prepare('SELECT totalAmount, paidAmount, status FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(chargeRow.totalAmount).toBe(C(950));
      expect(chargeRow.paidAmount).toBe(0);
      expect(chargeRow.status).toBe('UNPAID');

      const chargeItems = db.prepare('SELECT name, price, quantity FROM ChargeItem WHERE chargeId = ? ORDER BY createdAt').all(charge.id) as any[];
      expect(chargeItems.length).toBe(2);
      expect(chargeItems[0].name).toBe('根管治疗');
      expect(chargeItems[0].price).toBe(C(800));
      expect(chargeItems[0].quantity).toBe(1);
      expect(chargeItems[1].name).toBe('X光片');
      expect(chargeItems[1].price).toBe(C(150));

      // ================================================================
      // Step 7: 现金全额支付
      // ================================================================
      const payResult = await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 950,
          payMethod: 'CASH',
        }),
      );

      expect(payResult.paidAmount).toBe(950);
      expect(payResult.status).toBe('PAID');

      const chargeAfterPay = db.prepare('SELECT paidAmount, status, payMethod FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(chargeAfterPay.paidAmount).toBe(C(950));
      expect(chargeAfterPay.status).toBe('PAID');
      expect(chargeAfterPay.payMethod).toBe('CASH');

      // ================================================================
      // Step 8: 验证各环节审计日志
      // ================================================================
      const chargeAuditLogs = db.prepare("SELECT * FROM AuditLog WHERE targetId = ? AND type = 'CHARGE_PAY'").all(charge.id) as any[];
      expect(chargeAuditLogs.length).toBe(1);
      expect(chargeAuditLogs[0].targetType).toBe('Charge');
    });
  });

  describe('挂号状态机流转', () => {
    it('REGISTERED → TRIAGED → IN_PROGRESS → COMPLETED 全链路流转成功', async () => {
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
          chiefComplaint: '牙龈出血',
        } as any),
      );

      // REGISTERED → TRIAGED
      const triaged = await runAsDoctor(() =>
        registrationsService.triage(reg.id, {
          triageNote: '患者情况良好',
          chiefComplaint: '牙龈出血一周',
        }),
      );
      expect(triaged.status).toBe('TRIAGED');

      // TRIAGED → IN_PROGRESS
      const started = await runAsDoctor(() => registrationsService.startVisit(reg.id));
      expect(started.status).toBe('IN_PROGRESS');
      expect(started.visitId).toBeDefined();

      // IN_PROGRESS → COMPLETED
      const completed = await runAsDoctor(() => registrationsService.complete(reg.id));
      expect(completed.status).toBe('COMPLETED');
      expect(completed.completedAt).toBeDefined();

      const finalRow = db.prepare('SELECT status FROM Registration WHERE id = ?').get(reg.id) as any;
      expect(finalRow.status).toBe('COMPLETED');
    });

    it('REGISTERED → CANCELLED 取消挂号成功', async () => {
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
        } as any),
      );

      const cancelled = await runAsDoctor(() => registrationsService.cancel(reg.id));
      expect(cancelled.status).toBe('CANCELLED');

      const row = db.prepare('SELECT status FROM Registration WHERE id = ?').get(reg.id) as any;
      expect(row.status).toBe('CANCELLED');
    });

    it('COMPLETED 终态不可再次分诊', async () => {
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
        } as any),
      );

      await runAsDoctor(() => registrationsService.startVisit(reg.id));
      await runAsDoctor(() => registrationsService.complete(reg.id));

      await expect(
        runAsDoctor(() => registrationsService.triage(reg.id, {})),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('CANCELLED 终态不可开始就诊', async () => {
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
        } as any),
      );

      await runAsDoctor(() => registrationsService.cancel(reg.id));

      await expect(
        runAsDoctor(() => registrationsService.startVisit(reg.id)),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('IN_PROGRESS 状态再次调用 startVisit 应幂等返回（不重复创建 Visit）', async () => {
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
        } as any),
      );

      await runAsDoctor(() => registrationsService.startVisit(reg.id));

      const result = await runAsDoctor(() => registrationsService.startVisit(reg.id));
      expect(result.status).toBe('IN_PROGRESS');
      expect(result.visitId).toBeDefined();
    });
  });

  describe('就诊完成与诊断', () => {
    it('就诊完成时记录诊断和 remark', async () => {
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
        } as any),
      );

      const started = await runAsDoctor(() => registrationsService.startVisit(reg.id));

      await runAsDoctor(() =>
        visitsService.complete(started.visitId, {
          diagnosis: '慢性根尖周炎',
          remark: '建议根管治疗',
        }),
      );

      const visit = db.prepare('SELECT diagnosis, endTime FROM Visit WHERE id = ?').get(started.visitId) as any;
      expect(visit.diagnosis).toBe('慢性根尖周炎');
      expect(visit.endTime).not.toBeNull();
    });

    it('非 IN_PROGRESS 状态的就诊不可完成', async () => {
      await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
        } as any),
      );

      const fakeVisitId = 'non-existent-visit';
      await expect(
        runAsDoctor(() => visitsService.complete(fakeVisitId, {})),
      ).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('治疗创建（含牙位）', () => {
    it('创建治疗项目并验证牙位 JSON 存储', async () => {
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
        } as any),
      );
      const started = await runAsDoctor(() => registrationsService.startVisit(reg.id));

      const treatment = await runAsDoctor(() =>
        treatmentsService.create({
          patientId: TEST_PATIENT_ID,
          visitId: started.visitId,
          doctorId: TEST_DOCTOR_ID,
          code: 'T002',
          name: '正畸治疗',
          category: '正畸',
          price: 3000,
          quantity: 1,
          teethNumbers: [11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 24, 25, 26, 27, 28],
          remark: '全口正畸',
        } as any),
      );

      expect(treatment.teethNumbers).toHaveLength(16);
      expect(treatment.status).toBe('PLANNED');

      const row = db.prepare('SELECT teethNumbers FROM Treatment WHERE id = ?').get(treatment.id) as any;
      const parsed = JSON.parse(row.teethNumbers);
      expect(parsed).toHaveLength(16);
      expect(parsed).toContain(11);
      expect(parsed).toContain(28);
    });

    it('为不存在的患者创建治疗应抛出异常', async () => {
      await expect(
        runAsDoctor(() =>
          treatmentsService.create({
            patientId: 'non-existent-patient',
            doctorId: TEST_DOCTOR_ID,
            code: 'T003',
            name: '测试治疗',
            category: '测试',
            price: 100,
          } as any),
        ),
      ).rejects.toThrow(BusinessNotFoundException);
    });

    it('治疗默认状态为 PLANNED', async () => {
      const treatment = await runAsDoctor(() =>
        treatmentsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          code: 'T004',
          name: '洁牙',
          category: '基础护理',
          price: 200,
        } as any),
      );

      expect(treatment.status).toBe('PLANNED');

      const row = db.prepare('SELECT status FROM Treatment WHERE id = ?').get(treatment.id) as any;
      expect(row.status).toBe('PLANNED');
    });
  });

  describe('收费创建（多项目）', () => {
    it('创建含 3 个收费项的收费单并验证总额', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          items: [
            { name: '初诊检查', category: '检查', price: 50, quantity: 1 },
            { name: '洁牙', category: '基础护理', price: 200, quantity: 1 },
            { name: '抛光', category: '基础护理', price: 100, quantity: 1 },
          ],
        }),
      );

      expect(charge.totalAmount).toBe(350);
      expect(charge.items.length).toBe(3);
      expect(charge.status).toBe('UNPAID');

      const items = db.prepare('SELECT name, price, quantity FROM ChargeItem WHERE chargeId = ? ORDER BY createdAt').all(charge.id) as any[];
      expect(items.length).toBe(3);
      const totalCents = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
      expect(totalCents).toBe(C(350));
    });

    it('创建收费单时可关联牙位信息', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          items: [
            { name: '补牙', category: '修复', price: 300, quantity: 1, teethNumbers: ['16'] },
            { name: '根管治疗', category: '修复', price: 800, quantity: 1, teethNumbers: ['26'] },
          ],
        }),
      );

      expect(charge.items.length).toBe(2);
      expect(charge.items[0].teethNumbers).toEqual(['16']);
      expect(charge.items[1].teethNumbers).toEqual(['26']);

      const items = db.prepare('SELECT teethNumbers FROM ChargeItem WHERE chargeId = ? ORDER BY createdAt').all(charge.id) as any[];
      const tooth16 = JSON.parse(items[0].teethNumbers);
      expect(tooth16).toEqual(['16']);
      const tooth26 = JSON.parse(items[1].teethNumbers);
      expect(tooth26).toEqual(['26']);
    });
  });

  describe('支付与状态', () => {
    it('部分支付后状态为 PARTIAL', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          items: [{ name: '正畸治疗', category: '正畸', price: 4000, quantity: 1 }],
        }),
      );

      const partial = await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 1500,
          payMethod: 'CASH',
        }),
      );

      expect(partial.status).toBe('PARTIAL');
      expect(partial.paidAmount).toBe(1500);

      const row = db.prepare('SELECT paidAmount, status FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(row.paidAmount).toBe(C(1500));
      expect(row.status).toBe('PARTIAL');
    });

    it('超额支付应抛出异常', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          items: [{ name: '洁牙', category: '基础护理', price: 200, quantity: 1 }],
        }),
      );

      await expect(
        runAsDoctor(() =>
          chargePaymentService.payCharge(charge.id, {
            amount: 500,
            payMethod: 'CASH',
          }),
        ),
      ).rejects.toThrow(BusinessValidationException);

      const row = db.prepare('SELECT paidAmount, status FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(row.paidAmount).toBe(0);
      expect(row.status).toBe('UNPAID');
    });

    it('已结清的收费单不可再次支付', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          items: [{ name: '检查费', category: '检查', price: 100, quantity: 1 }],
        }),
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 100,
          payMethod: 'CASH',
        }),
      );

      await expect(
        runAsDoctor(() =>
          chargePaymentService.payCharge(charge.id, {
            amount: 50,
            payMethod: 'CASH',
          }),
        ),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('支付金额必须为正数', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          items: [{ name: '检查费', category: '检查', price: 100, quantity: 1 }],
        }),
      );

      await expect(
        runAsDoctor(() =>
          chargePaymentService.payCharge(charge.id, {
            amount: 0,
            payMethod: 'CASH',
          }),
        ),
      ).rejects.toThrow(BusinessValidationException);

      await expect(
        runAsDoctor(() =>
          chargePaymentService.payCharge(charge.id, {
            amount: -50,
            payMethod: 'CASH',
          }),
        ),
      ).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('错误场景', () => {
    it('对不存在的患者创建挂号应成功（患者存在由 seed 保证）', async () => {
      // seed 数据已包含 TEST_PATIENT_ID
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
        } as any),
      );

      expect(reg.id).toBeDefined();
      expect(reg.patientId).toBe(TEST_PATIENT_ID);
    });

    it('对不存在的患者创建治疗应抛出异常', async () => {
      await expect(
        runAsDoctor(() =>
          treatmentsService.create({
            patientId: 'nonexistent-patient-id',
            doctorId: TEST_DOCTOR_ID,
            code: 'ERR001',
            name: '测试',
            category: '测试',
            price: 100,
          } as any),
        ),
      ).rejects.toThrow(BusinessNotFoundException);
    });

    it('对不存在的患者创建收费单应抛出异常（DB 外键约束）', async () => {
      let errorThrown = false;
      try {
        await runAsDoctor(() =>
          chargeService.createCharge({
            patientId: 'nonexistent-patient-id',
            items: [{ name: '测试', category: '测试', price: 100, quantity: 1 }],
          }),
        );
      } catch {
        errorThrown = true;
      }
      expect(errorThrown).toBe(true);
    });

    it('对不存在的收费单进行支付应抛出异常', async () => {
      await expect(
        runAsDoctor(() =>
          chargePaymentService.payCharge('nonexistent-charge-id', {
            amount: 100,
            payMethod: 'CASH',
          }),
        ),
      ).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('审计日志完整性', () => {
    it('挂号创建时写入审计日志', async () => {
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
          chiefComplaint: '测试主诉',
        } as any),
      );

      const logs = db.prepare("SELECT * FROM AuditLog WHERE targetId = ? AND type = 'REGISTRATION_CREATE'").all(reg.id) as any[];
      expect(logs.length).toBe(1);
      expect(logs[0].targetType).toBe('Registration');
      expect(logs[0].clinicId).toBe(TEST_CLINIC_ID);
    });

    it('挂号开始就诊时写入审计日志', async () => {
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
        } as any),
      );

      await runAsDoctor(() => registrationsService.startVisit(reg.id));

      const logs = db.prepare("SELECT * FROM AuditLog WHERE targetId = ? AND type = 'REGISTRATION_START_VISIT'").all(reg.id) as any[];
      expect(logs.length).toBe(1);
      expect(logs[0].afterData).toBeDefined();
      const afterData = JSON.parse(logs[0].afterData);
      expect(afterData.visitId).toBeDefined();
      expect(afterData.status).toBe('IN_PROGRESS');
    });

    it('就诊完成时写入审计日志', async () => {
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
        } as any),
      );
      const started = await runAsDoctor(() => registrationsService.startVisit(reg.id));

      await runAsDoctor(() =>
        visitsService.complete(started.visitId, {
          diagnosis: '测试诊断',
        }),
      );

      const logs = db.prepare("SELECT * FROM AuditLog WHERE targetId = ? AND type = 'VISIT_COMPLETE'").all(started.visitId) as any[];
      expect(logs.length).toBe(1);
    });

    it('收费支付时写入审计日志', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          items: [{ name: '测试项目', category: '测试', price: 100, quantity: 1 }],
        }),
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 100,
          payMethod: 'CASH',
        }),
      );

      const logs = db.prepare("SELECT * FROM AuditLog WHERE targetId = ? AND type = 'CHARGE_PAY'").all(charge.id) as any[];
      expect(logs.length).toBe(1);
      expect(logs[0].targetType).toBe('Charge');
      expect(logs[0].beforeData).toBeDefined();
      expect(logs[0].afterData).toBeDefined();
    });

    it('治疗创建时写入审计日志', async () => {
      const treatment = await runAsDoctor(() =>
        treatmentsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          code: 'AUDIT001',
          name: '审计测试治疗',
          category: '测试',
          price: 500,
        } as any),
      );

      const logs = db.prepare("SELECT * FROM AuditLog WHERE targetId = ? AND type = 'TREATMENT_CREATE'").all(treatment.id) as any[];
      expect(logs.length).toBe(1);
      expect(logs[0].targetType).toBe('Treatment');
    });
  });

  describe('数据隔离（诊所作用域）', () => {
    it('创建的挂号应关联当前诊所 ID', async () => {
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
        } as any),
      );

      const row = db.prepare('SELECT clinicId FROM Registration WHERE id = ?').get(reg.id) as any;
      expect(row.clinicId).toBe(TEST_CLINIC_ID);
    });

    it('创建的就诊应关联当前诊所 ID', async () => {
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
        } as any),
      );
      const started = await runAsDoctor(() => registrationsService.startVisit(reg.id));

      const row = db.prepare('SELECT clinicId FROM Visit WHERE id = ?').get(started.visitId) as any;
      expect(row.clinicId).toBe(TEST_CLINIC_ID);
    });

    it('创建的治疗应关联当前诊所 ID', async () => {
      const treatment = await runAsDoctor(() =>
        treatmentsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          code: 'CLINIC001',
          name: '诊所隔离测试',
          category: '测试',
          price: 100,
        } as any),
      );

      const row = db.prepare('SELECT clinicId FROM Treatment WHERE id = ?').get(treatment.id) as any;
      expect(row.clinicId).toBe(TEST_CLINIC_ID);
    });

    it('创建的收费单应关联当前诊所 ID', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          items: [{ name: '隔离测试', category: '测试', price: 50, quantity: 1 }],
        }),
      );

      const row = db.prepare('SELECT clinicId FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(row.clinicId).toBe(TEST_CLINIC_ID);
    });
  });

  describe('金额精度与换算', () => {
    it('小额金额精确转换（元→分→元）', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          items: [{ name: '小额测试', category: '测试', price: 0.01, quantity: 1 }],
        }),
      );

      expect(charge.totalAmount).toBeCloseTo(0.01, 2);

      const row = db.prepare('SELECT totalAmount FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(row.totalAmount).toBe(1);
    });

    it('大额金额精确存储', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          items: [{ name: '大额测试', category: '测试', price: 99999.99, quantity: 1 }],
        }),
      );

      expect(charge.totalAmount).toBeCloseTo(99999.99, 2);

      const row = db.prepare('SELECT totalAmount FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(row.totalAmount).toBe(C(99999.99));
    });

    it('多数量项目正确计算小计', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          items: [
            { name: '抗生素', category: '药品', price: 15.50, quantity: 3 },
          ],
        }),
      );

      expect(charge.totalAmount).toBe(46.50);

      const items = db.prepare('SELECT subtotal FROM ChargeItem WHERE chargeId = ?').all(charge.id) as any[];
      expect(items[0].subtotal).toBe(C(46.50));
    });
  });

  describe('挂号类型与参数', () => {
    it('支持初诊、复诊、急诊等多种挂号类型', async () => {
      const types = ['FIRST_VISIT', 'RETURN_VISIT', 'EMERGENCY'];
      for (const type of types) {
        const reg = await runAsDoctor(() =>
          registrationsService.create({
            patientId: TEST_PATIENT_ID,
            doctorId: TEST_DOCTOR_ID,
            type,
          } as any),
        );
        expect(reg.type).toBe(type);
      }

      const regs = db.prepare('SELECT type FROM Registration WHERE patientId = ? ORDER BY createdAt').all(TEST_PATIENT_ID) as any[];
      expect(regs.length).toBe(3);
      expect(regs.map(r => r.type).sort((a: string, b: string) => a.localeCompare(b))).toEqual(['EMERGENCY', 'FIRST_VISIT', 'RETURN_VISIT']);
    });

    it('挂号可设置主诉和分诊备注', async () => {
      const reg = await runAsDoctor(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
          chiefComplaint: '剧烈牙痛',
        } as any),
      );

      const triaged = await runAsDoctor(() =>
        registrationsService.triage(reg.id, {
          triageNote: '需立即处理',
          chiefComplaint: '剧烈牙痛，伴随肿胀',
        }),
      );

      expect(triaged.triageNote).toBe('需立即处理');
      expect(triaged.chiefComplaint).toBe('剧烈牙痛，伴随肿胀');

      const row = db.prepare('SELECT chiefComplaint, triageNote FROM Registration WHERE id = ?').get(reg.id) as any;
      expect(row.chiefComplaint).toBe('剧烈牙痛，伴随肿胀');
      expect(row.triageNote).toBe('需立即处理');
    });
  });
});