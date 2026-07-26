import { Test, TestingModule } from '@nestjs/testing';
import { DbService } from '@db/db.service';
import { ClinicContextService } from '@common/services/clinic-context.service';
import { IdempotencyService } from '@common/services/idempotency.service';
import { CacheService } from '@common/services/cache.service';
import {
  createTestDb,
  cleanupTestDb,
  createTestDbService,
  seedTestData,
  runInClinicContext,
} from '@db/test-helpers';
import {
  TEST_CLINIC_ID,
  TEST_PATIENT_ID,
  TEST_DOCTOR_ID,
  TEST_MEMBER_CARD_ID,
} from './factories';
import { RegistrationsService } from '@modules/clinical/registrations/registrations.service';
import { VisitsService } from '@modules/clinical/visits/visits.service';
import { ChargeService } from '@modules/financial/charge/charge.service';
import { ChargePaymentService } from '@modules/financial/charge/charge-payment.service';
import { RefundsService } from '@modules/financial/refunds/refunds.service';
import { DebtService } from '@modules/financial/charge/debt.service';
import { MemberCardsService } from '@modules/financial/member-cards/member-cards.service';
import { AppointmentsService } from '@modules/scheduling/appointments/appointments.service';
import { PatientsService } from '@modules/patients/patients.service';
import { ComboService } from '@modules/financial/charge/combo.service';
import { PaymentMethodService } from '@modules/financial/charge/payment-method.service';

describe('Core Business Flow E2E - 预约→挂号→收费→退款', () => {
  let appointmentsService: AppointmentsService;
  let registrationsService: RegistrationsService;
  let _visitsService: VisitsService;
  let chargeService: ChargeService;
  let chargePaymentService: ChargePaymentService;
  let refundsService: RefundsService;
  let _debtService: DebtService;
  let memberCardsService: MemberCardsService;
  let patientsService: PatientsService;
  let clinicContext: ClinicContextService;
  let db: ReturnType<typeof createTestDb>;
  let module: TestingModule;

  const runAsDoctor = <T>(fn: () => T) =>
    runInClinicContext(
      clinicContext,
      { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
      fn,
    );

  const runAsReceptionist = <T>(fn: () => T) =>
    runInClinicContext(
      clinicContext,
      { clinicId: TEST_CLINIC_ID, userId: 'recep-001', role: 'RECEPTIONIST' },
      fn,
    );

  beforeEach(async () => {
    db = createTestDb();
    seedTestData(db, { withMemberCard: true });

    const testDbService = createTestDbService(db);

    module = await Test.createTestingModule({
      providers: [
        { provide: DbService, useValue: testDbService },
        ClinicContextService,
        IdempotencyService,
        CacheService,
        AppointmentsService,
        RegistrationsService,
        VisitsService,
        ChargeService,
        ChargePaymentService,
        RefundsService,
        DebtService,
        MemberCardsService,
        PatientsService,
        ComboService,
        PaymentMethodService,
      ],
    }).compile();

    appointmentsService = module.get(AppointmentsService);
    registrationsService = module.get(RegistrationsService);
    _visitsService = module.get(VisitsService);
    chargeService = module.get(ChargeService);
    chargePaymentService = module.get(ChargePaymentService);
    refundsService = module.get(RefundsService);
    _debtService = module.get(DebtService);
    memberCardsService = module.get(MemberCardsService);
    patientsService = module.get(PatientsService);
    clinicContext = module.get(ClinicContextService);
  });

  afterEach(() => {
    cleanupTestDb(db);
  });

  const C = (yuan: number) => yuan * 100;

  const FUTURE = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

  describe('预约流程', () => {
    it('创建预约成功，状态为 BOOKED', async () => {
      const appointment = await runAsReceptionist(() =>
        appointmentsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          startTime: FUTURE(3600_000),
          endTime: FUTURE(7200_000),
          type: 'FOLLOW_UP',
          remark: '复查',
        } as any),
      );

      expect(appointment.id).toBeDefined();
      expect((appointment as any).status).toBe('BOOKED');
    });

    it('预约状态流转：BOOKED → ARRIVED → IN_CHAIR → COMPLETED', async () => {
      const apt = await runAsReceptionist(() =>
        appointmentsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          startTime: FUTURE(3600_000),
          endTime: FUTURE(7200_000),
          type: 'FIRST_VISIT',
        } as any),
      );

      const arrived = await runAsReceptionist(() =>
        appointmentsService.update(apt.id, { status: 'ARRIVED' } as any),
      );
      expect((arrived as any).status).toBe('ARRIVED');

      const inChair = await runAsDoctor(() =>
        appointmentsService.update(apt.id, { status: 'IN_CHAIR' } as any),
      );
      expect((inChair as any).status).toBe('IN_CHAIR');

      const completed = await runAsDoctor(() =>
        appointmentsService.update(apt.id, { status: 'COMPLETED' } as any),
      );
      expect((completed as any).status).toBe('COMPLETED');
    });

    it('非法状态跳转被拒绝', async () => {
      const apt = await runAsReceptionist(() =>
        appointmentsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          startTime: FUTURE(3600_000),
          endTime: FUTURE(7200_000),
          type: 'FIRST_VISIT',
        } as any),
      );

      await expect(
        runAsReceptionist(() =>
          appointmentsService.update(apt.id, { status: 'COMPLETED' } as any),
        ),
      ).rejects.toThrow();
    });

    it('软删除预约，记录保留 deletedAt', async () => {
      const apt = await runAsReceptionist(() =>
        appointmentsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          startTime: FUTURE(3600_000),
          endTime: FUTURE(7200_000),
          type: 'FIRST_VISIT',
        } as any),
      );

      await runAsReceptionist(() => appointmentsService.softDelete(apt.id));

      const row = db.prepare('SELECT deletedAt FROM Appointment WHERE id = ?').get(apt.id) as any;
      expect(row.deletedAt).not.toBeNull();
    });
  });

  describe('挂号流程', () => {
    it('创建挂号成功', async () => {
      const reg = await runAsReceptionist(() =>
        registrationsService.create({
          patientId: TEST_PATIENT_ID,
          doctorId: TEST_DOCTOR_ID,
          type: 'FIRST_VISIT',
          chiefComplaint: '牙痛3天',
        } as any),
      );

      expect(reg.id).toBeDefined();
      expect((reg as any).patientId).toBe(TEST_PATIENT_ID);
      expect((reg as any).doctorId).toBe(TEST_DOCTOR_ID);
    });

    it('挂号列表分页查询', async () => {
      for (let i = 0; i < 5; i++) {
        await runAsReceptionist(() =>
          registrationsService.create({
            patientId: TEST_PATIENT_ID,
            doctorId: TEST_DOCTOR_ID,
            type: 'FIRST_VISIT',
            chiefComplaint: `主诉${i}`,
          } as any),
        );
      }

      const result = await runAsReceptionist(() =>
        registrationsService.findMany({ page: 1, pageSize: 3 } as any),
      );

      expect((result as any).items.length).toBe(3);
      expect((result as any).total).toBe(5);
    });
  });

  describe('收费流程', () => {
    it('现金支付 - 创建收费单并支付', async () => {
      const charge = runAsReceptionist(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [
            { name: '挂号费', quantity: 1, price: 20, category: 'EXAMINATION' },
            { name: 'X光片', quantity: 1, price: 150, category: 'IMAGING' },
          ],
        }),
      );

      expect(charge.id).toBeDefined();
      expect(charge.status).toBe('UNPAID');
      expect(charge.totalAmount).toBe(170);

      const paid = await runAsReceptionist(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 170,
          payMethod: 'CASH',
        }),
      );

      expect(paid.status).toBe('PAID');
      expect(paid.paidAmount).toBe(170);

      const chargeRow = db.prepare('SELECT status, paidAmount, totalAmount FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(chargeRow.status).toBe('PAID');
      expect(chargeRow.paidAmount).toBe(C(170));
    });

    it('会员卡支付 - 余额正确扣减', async () => {
      const cardBefore = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;
      expect(cardBefore.balance).toBe(C(1000));

      const charge = runAsReceptionist(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [
            { name: '洗牙', quantity: 1, price: 300, category: 'TREATMENT' },
          ],
        }),
      );

      const paid = await runAsReceptionist(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 300,
          payMethod: 'MEMBER_CARD',
          memberCardId: TEST_MEMBER_CARD_ID,
        }),
      );

      expect(paid.status).toBe('PAID');

      const cardAfter = db.prepare('SELECT balance, totalConsume FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;
      expect(cardAfter.balance).toBe(C(700));
      expect(cardAfter.totalConsume).toBe(C(300));
    });

    it('会员卡余额不足时支付被拒绝', async () => {
      const charge = runAsReceptionist(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [
            { name: '种植牙', quantity: 1, price: 5000, category: 'TREATMENT' },
          ],
        }),
      );

      await expect(
        runAsReceptionist(() =>
          chargePaymentService.payCharge(charge.id, {
            amount: 5000,
            payMethod: 'MEMBER_CARD',
            memberCardId: TEST_MEMBER_CARD_ID,
          }),
        ),
      ).rejects.toThrow();

      const chargeRow = db.prepare('SELECT status FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(chargeRow.status).toBe('UNPAID');
    });

    it('部分支付后状态为 PARTIAL', async () => {
      const charge = runAsReceptionist(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [
            { name: '根管治疗', quantity: 1, price: 800, category: 'TREATMENT' },
          ],
        }),
      );

      const paid = await runAsReceptionist(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 300,
          payMethod: 'CASH',
        }),
      );

      expect(paid.status).toBe('PARTIAL');
      expect(paid.paidAmount).toBe(300);
    });
  });

  describe('退款流程', () => {
    it('全额退款 - 收费单状态变为 REFUNDED，会员卡余额回退', async () => {
      const cardBefore = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;

      const charge = runAsReceptionist(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [
            { name: '补牙', quantity: 1, price: 500, category: 'TREATMENT' },
          ],
        }),
      );

      await runAsReceptionist(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 500,
          payMethod: 'MEMBER_CARD',
          memberCardId: TEST_MEMBER_CARD_ID,
        }),
      );

      const cardMid = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;
      expect(cardMid.balance).toBe(cardBefore.balance - C(500));

      const refund = await runAsReceptionist(() =>
        refundsService.createRefund({
          chargeId: charge.id,
          amount: 500,
          reason: '患者取消治疗',
        }),
      );

      expect((refund as any).id).toBeDefined();
      expect((refund as any).amount).toBe(500);

      const cardAfter = db.prepare('SELECT balance, totalConsume FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;
      expect(cardAfter.balance).toBe(cardBefore.balance);

      const chargeRow = db.prepare('SELECT status, refundedAmount FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(chargeRow.status).toBe('REFUNDED');
      expect(chargeRow.refundedAmount).toBe(C(500));
    });

    it('退款金额超过已付金额时被拒绝', async () => {
      const charge = runAsReceptionist(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [
            { name: '洁牙', quantity: 1, price: 200, category: 'TREATMENT' },
          ],
        }),
      );

      await runAsReceptionist(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 200,
          payMethod: 'CASH',
        }),
      );

      await expect(
        runAsReceptionist(() =>
          refundsService.createRefund({
            chargeId: charge.id,
            amount: 300,
            reason: '测试超额退款',
          }),
        ),
      ).rejects.toThrow();
    });
  });

  describe('软删除级联验证', () => {
    it('删除收费单后收费项目被级联软删除', async () => {
      const charge = runAsReceptionist(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [
            { name: '检查费', quantity: 1, price: 50, category: 'EXAMINATION' },
          ],
        }),
      );

      const itemsBefore = db.prepare('SELECT COUNT(*) as cnt FROM ChargeItem WHERE chargeId = ? AND deletedAt IS NULL').get(charge.id) as any;
      expect(itemsBefore.cnt).toBe(1);

      await runAsReceptionist(() => chargeService.softDelete(charge.id));

      const chargeAfter = db.prepare('SELECT deletedAt FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(chargeAfter.deletedAt).not.toBeNull();

      const itemsAfter = db.prepare('SELECT COUNT(*) as cnt FROM ChargeItem WHERE chargeId = ? AND deletedAt IS NULL').get(charge.id) as any;
      expect(itemsAfter.cnt).toBe(0);
    });
  });

  describe('并发安全验证', () => {
    it('连续两次会员卡扣费，第二次因余额不足失败，不会出现负余额', async () => {
      const cardBefore = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;

      const charges = [
        runAsReceptionist(() =>
          chargeService.createCharge({
            patientId: TEST_PATIENT_ID,
            items: [{ name: '项目A', quantity: 1, price: 600, category: 'TREATMENT' }],
          }),
        ),
        runAsReceptionist(() =>
          chargeService.createCharge({
            patientId: TEST_PATIENT_ID,
            items: [{ name: '项目B', quantity: 1, price: 600, category: 'TREATMENT' }],
          }),
        ),
      ];

      let successCount = 0;
      let failCount = 0;

      try {
        await runAsReceptionist(() =>
          chargePaymentService.payCharge(charges[0].id, {
            amount: 600,
            payMethod: 'MEMBER_CARD',
            memberCardId: TEST_MEMBER_CARD_ID,
          }),
        );
        successCount++;
      } catch {
        failCount++;
      }

      try {
        await runAsReceptionist(() =>
          chargePaymentService.payCharge(charges[1].id, {
            amount: 600,
            payMethod: 'MEMBER_CARD',
            memberCardId: TEST_MEMBER_CARD_ID,
          }),
        );
        successCount++;
      } catch {
        failCount++;
      }

      expect(successCount + failCount).toBe(2);
      expect(successCount).toBeLessThanOrEqual(1);

      const cardAfter = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;
      expect(cardAfter.balance).toBeGreaterThanOrEqual(0);
      expect(cardAfter.balance).toBe(cardBefore.balance - C(600) * successCount);
    });
  });

  describe('幂等性验证', () => {
    it('相同 requestId 的会员卡充值只生效一次', async () => {
      const cardBefore = db.prepare('SELECT balance, totalRecharge FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;
      const requestId = 'test-idempotent-recharge-001';

      await runAsReceptionist(() =>
        memberCardsService.recharge(TEST_MEMBER_CARD_ID, 500, requestId),
      );

      await runAsReceptionist(() =>
        memberCardsService.recharge(TEST_MEMBER_CARD_ID, 500, requestId),
      );

      const cardAfter = db.prepare('SELECT balance, totalRecharge FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;
      expect(cardAfter.balance).toBe(cardBefore.balance + C(500));
      expect(cardAfter.totalRecharge).toBe(cardBefore.totalRecharge + C(500));
    });
  });

  describe('患者管理', () => {
    it('创建患者并查询', async () => {
      const patient = await runAsReceptionist(() =>
        patientsService.create({
          name: '新患者',
          gender: 'FEMALE',
          phone: '13900139000',
          birthDate: '1995-05-20',
        } as any),
      );

      expect(patient.id).toBeDefined();
      expect(patient.name).toBe('新患者');

      const found = await runAsReceptionist(() => patientsService.findOne(patient.id));
      expect(found.name).toBe('新患者');
    });

    it('患者列表按姓名搜索', async () => {
      await runAsReceptionist(() =>
        patientsService.create({
          name: '张三',
          gender: 'MALE',
          phone: '13800000001',
          code: 'P-TEST-001',
        } as any),
      );
      await runAsReceptionist(() =>
        patientsService.create({
          name: '李四',
          gender: 'FEMALE',
          phone: '13800000002',
          code: 'P-TEST-002',
        } as any),
      );

      const result = await runAsReceptionist(() =>
        patientsService.findMany({ page: 1, pageSize: 10, keyword: '张' } as any),
      );

      expect((result as any).items.length).toBeGreaterThanOrEqual(1);
    });
  });
});
