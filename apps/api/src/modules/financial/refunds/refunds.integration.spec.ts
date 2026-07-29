import { Test, TestingModule } from '@nestjs/testing';
import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { RefundsService } from './refunds.service';
import { ChargeService } from '../charge/charge.service';
import { ChargePaymentService } from '../charge/charge-payment.service';
import { DebtService } from '../charge/debt.service';
import { ComboService } from '../charge/combo.service';
import { PaymentMethodService } from '../charge/payment-method.service';
import { MemberCardsService } from '../member-cards/member-cards.service';
import { DbService } from '../../../db/db.service';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { CacheService } from '../../../common/services/cache.service';
import { StatsService } from '../../system/stats/stats.service';
import { EventBusService } from '../../../common/events/event-bus.service';
import { RefundRepository } from './repositories/refund.repository';
import { ChargeRepository } from '../charge/repositories/charge.repository';
import { MemberCardLogRepository } from '../member-cards/repositories/member-card-log.repository';
import { MemberPointLogRepository } from '../member-cards/repositories/member-point-log.repository';
import {
  createTestDb,
  cleanupTestDb,
  createTestDbService,
  seedTestData,
  runInClinicContext,
} from '../../../db/test-helpers';
import {
  TEST_CLINIC_ID,
  TEST_PATIENT_ID,
  TEST_DOCTOR_ID,
  TEST_MEMBER_CARD_ID,
} from '../../../../test/factories';

describe('RefundsService - Integration', () => {
  let service: RefundsService;
  let chargeService: ChargeService;
  let chargePaymentService: ChargePaymentService;
  let debtService: DebtService;
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
    seedTestData(db, { withMemberCard: true });

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
        RefundRepository,
        ChargeRepository,
        ChargeService,
        ChargePaymentService,
        DebtService,
        ComboService,
        PaymentMethodService,
        // P0 修复：使用真实 MemberCardsService 实例，以支持 consumeSync 委托调用
        MemberCardLogRepository,
        MemberPointLogRepository,
        MemberCardsService,
        RefundsService,
      ],
    }).compile();

    service = module.get(RefundsService);
    chargeService = module.get(ChargeService);
    chargePaymentService = module.get(ChargePaymentService);
    debtService = module.get(DebtService);
    clinicContext = module.get(ClinicContextService);
  });

  afterEach(() => {
    cleanupTestDb(db);
  });

  describe('create - 创建退款单', () => {
    it('应成功创建退款单并更新收费单退款金额', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 300, quantity: 1 }],
        })
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, { amount: 300, payMethod: 'CASH' })
      );

      const result = await runAsDoctor(() =>
        service.createRefund(
          { chargeId: charge.id, amount: 100, reason: '患者取消' },
          { id: TEST_DOCTOR_ID, name: '张医生' }
        )
      );

      expect(result.id).toBeDefined();
      expect(result.amount).toBe(100);

      const refund = db.prepare("SELECT * FROM Refund WHERE id = ?").get(result.id) as any;
      expect(refund.chargeId).toBe(charge.id);
      expect(refund.patientId).toBe(TEST_PATIENT_ID);
      expect(refund.amount).toBe(10000);
      expect(refund.reason).toBe('患者取消');
      expect(refund.operatorId).toBe(TEST_DOCTOR_ID);
      expect(refund.operatorName).toBe('张医生');

      const updatedCharge = db.prepare("SELECT refundedAmount, status FROM Charge WHERE id = ?").get(charge.id) as any;
      expect(updatedCharge.refundedAmount).toBe(10000);
      expect(updatedCharge.status).toBe('PAID');
    });

    it('全额退款应更新收费单状态为 REFUNDED', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 200, quantity: 1 }],
        })
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, { amount: 200, payMethod: 'CASH' })
      );

      await runAsDoctor(() =>
        service.createRefund({ chargeId: charge.id, amount: 200 })
      );

      const updatedCharge = db.prepare("SELECT refundedAmount, status FROM Charge WHERE id = ?").get(charge.id) as any;
      expect(updatedCharge.refundedAmount).toBe(20000);
      expect(updatedCharge.status).toBe('REFUNDED');
    });

    it('退款金额超过可退金额应抛出 BusinessValidationException', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 300, quantity: 1 }],
        })
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, { amount: 300, payMethod: 'CASH' })
      );

      await expect(
        runAsDoctor(() => service.createRefund({ chargeId: charge.id, amount: 500 }))
      ).rejects.toThrow(BusinessValidationException);
    });

    it('无可退金额应抛出 BusinessValidationException', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 300, quantity: 1 }],
        })
      );

      await expect(
        runAsDoctor(() => service.createRefund({ chargeId: charge.id, amount: 100 }))
      ).rejects.toThrow(BusinessValidationException);
    });

    it('收费记录不存在应抛出 BusinessNotFoundException', async () => {
      await expect(
        runAsDoctor(() => service.createRefund({ chargeId: 'non-existent', amount: 100 }))
      ).rejects.toThrow(BusinessNotFoundException);
    });

    it('退款金额为 0 应抛出 BusinessValidationException', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 300, quantity: 1 }],
        })
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, { amount: 300, payMethod: 'CASH' })
      );

      await expect(
        runAsDoctor(() => service.createRefund({ chargeId: charge.id, amount: 0 }))
      ).rejects.toThrow(BusinessValidationException);
    });

    it('退款金额为负数应抛出 BusinessValidationException', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 300, quantity: 1 }],
        })
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, { amount: 300, payMethod: 'CASH' })
      );

      await expect(
        runAsDoctor(() => service.createRefund({ chargeId: charge.id, amount: -50 }))
      ).rejects.toThrow(BusinessValidationException);
    });
  });

  describe('create - 会员卡退款', () => {
    it('会员卡支付的退款应回滚会员卡余额', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 300, quantity: 1 }],
        })
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 300,
          payMethod: 'MEMBER_CARD',
          memberCardId: TEST_MEMBER_CARD_ID,
        })
      );

      const afterPayCard = db.prepare("SELECT balance, totalConsume FROM MemberCard WHERE id = ?").get(TEST_MEMBER_CARD_ID) as any;
      expect(afterPayCard.balance).toBe(70000);
      expect(afterPayCard.totalConsume).toBe(30000);

      const result = await runAsDoctor(() =>
        service.createRefund({ chargeId: charge.id, amount: 100, reason: '部分退款' })
      );

      expect(result.memberCard).toBeDefined();
      expect(result.memberCard!.refundedAmount).toBe(100);
      expect(result.memberCard!.balanceAfter).toBe(800);

      const afterRefundCard = db.prepare("SELECT balance, totalConsume FROM MemberCard WHERE id = ?").get(TEST_MEMBER_CARD_ID) as any;
      expect(afterRefundCard.balance).toBe(80000);
      expect(afterRefundCard.totalConsume).toBe(20000);

      const cardLogs = db.prepare("SELECT * FROM MemberCardLog WHERE cardId = ? ORDER BY createdAt").all(TEST_MEMBER_CARD_ID) as any[];
      expect(cardLogs.length).toBe(2);
      expect(cardLogs[0].type).toBe('CONSUME');
      expect(cardLogs[1].type).toBe('REFUND');
      expect(cardLogs[1].amount).toBe(10000);
      expect(cardLogs[1].balanceAfter).toBe(80000);
      expect(cardLogs[1].chargeId).toBe(charge.id);
    });

    it('全额会员卡退款应完全回滚余额', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 200, quantity: 1 }],
        })
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 200,
          payMethod: 'MEMBER_CARD',
          memberCardId: TEST_MEMBER_CARD_ID,
        })
      );

      await runAsDoctor(() =>
        service.createRefund({ chargeId: charge.id, amount: 200 })
      );

      const afterRefundCard = db.prepare("SELECT balance, totalConsume FROM MemberCard WHERE id = ?").get(TEST_MEMBER_CARD_ID) as any;
      expect(afterRefundCard.balance).toBe(100000);
      expect(afterRefundCard.totalConsume).toBe(0);
    });
  });

  describe('create - 欠费同步回滚', () => {
    it('退款时应同步回滚关联的欠费记录', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '正畸治疗', category: '正畸', price: 5000, quantity: 1 }],
        })
      );

      const debt = await runAsDoctor(() =>
        debtService.createDebtFromCharge({
          chargeId: charge.id,
          patientId: TEST_PATIENT_ID,
          totalAmount: 5000,
          debtAmount: 3000,
        })
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, { amount: 2000, payMethod: 'CASH' })
      );

      await runAsDoctor(() =>
        debtService.payDebt(debt.id, { amount: 1000, payMethod: 'CASH' })
      );

      const beforeRefundDebt = db.prepare("SELECT paidAmount, debtAmount, status FROM DebtRecord WHERE id = ?").get(debt.id) as any;
      expect(beforeRefundDebt.paidAmount).toBe(300000);
      expect(beforeRefundDebt.debtAmount).toBe(200000);
      expect(beforeRefundDebt.status).toBe('PARTIAL');

      const result = await runAsDoctor(() =>
        service.createRefund({ chargeId: charge.id, amount: 500, reason: '项目调整' })
      );

      expect(result.debt).toBeDefined();
      expect(result.debt!.debtId).toBe(debt.id);

      const afterRefundDebt = db.prepare("SELECT paidAmount, debtAmount, status FROM DebtRecord WHERE id = ?").get(debt.id) as any;
      expect(afterRefundDebt.paidAmount).toBe(250000);
      expect(afterRefundDebt.debtAmount).toBe(250000);
      expect(afterRefundDebt.status).toBe('PARTIAL');
    });
  });

  describe('create - 审计日志', () => {
    it('退款应写入 AuditLog 审计日志', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 300, quantity: 1 }],
        })
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, { amount: 300, payMethod: 'CASH' })
      );

      await runAsDoctor(() =>
        service.createRefund(
          { chargeId: charge.id, amount: 100, reason: '测试退款' },
          { id: TEST_DOCTOR_ID, name: '张医生', ip: '127.0.0.1' }
        )
      );

      const auditLogs = db.prepare("SELECT * FROM AuditLog WHERE targetId = ? AND type = 'REFUND'").all(charge.id) as any[];
      expect(auditLogs.length).toBe(1);
      expect(auditLogs[0].targetType).toBe('Charge');
      expect(auditLogs[0].operatorId).toBe(TEST_DOCTOR_ID);
      expect(auditLogs[0].operatorName).toBe('张医生');
      expect(auditLogs[0].amount).toBe(100);
      expect(auditLogs[0].remark).toBe('测试退款');
      expect(auditLogs[0].ip).toBe('127.0.0.1');
      expect(auditLogs[0].beforeData).toBeDefined();
      expect(auditLogs[0].afterData).toBeDefined();
    });
  });

  describe('findByCharge - 查询收费单的退款', () => {
    it('应返回指定收费单的所有退款记录', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 500, quantity: 1 }],
        })
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, { amount: 500, payMethod: 'CASH' })
      );

      await runAsDoctor(() =>
        service.createRefund({ chargeId: charge.id, amount: 100, reason: '第一次退款' })
      );
      await runAsDoctor(() =>
        service.createRefund({ chargeId: charge.id, amount: 50, reason: '第二次退款' })
      );

      const result = await runAsDoctor(() => service.findByCharge(charge.id));

      expect(result.length).toBe(2);
    });
  });

  describe('findMany - 退款列表', () => {
    it('应返回分页退款列表', async () => {
      for (let i = 0; i < 3; i++) {
        const charge = await runAsDoctor(() =>
          chargeService.createCharge({
            patientId: TEST_PATIENT_ID,
            items: [{ name: `项目${i}`, category: '测试', price: 200, quantity: 1 }],
          })
        );
        await runAsDoctor(() =>
          chargePaymentService.payCharge(charge.id, { amount: 200, payMethod: 'CASH' })
        );
        await runAsDoctor(() =>
          service.createRefund({ chargeId: charge.id, amount: 50 })
        );
      }

      const result = await runAsDoctor(() =>
        service.findMany({ page: 1, pageSize: 10 })
      );

      expect(result.total).toBe(3);
      expect(result.items.length).toBe(3);
    });

    it('按 patientId 过滤退款', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 200, quantity: 1 }],
        })
      );
      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, { amount: 200, payMethod: 'CASH' })
      );
      await runAsDoctor(() =>
        service.createRefund({ chargeId: charge.id, amount: 50 })
      );

      const result = await runAsDoctor(() =>
        service.findMany({ filters: { patientId: TEST_PATIENT_ID } })
      );

      expect(result.total).toBe(1);
      expect(result.items.length).toBe(1);
    });
  });

  describe('findOne - 获取退款详情', () => {
    it('应返回退款详情', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 300, quantity: 1 }],
        })
      );
      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, { amount: 300, payMethod: 'CASH' })
      );
      const created = await runAsDoctor(() =>
        service.createRefund({ chargeId: charge.id, amount: 100 })
      );

      const result = await runAsDoctor(() => service.findOne(created.id));

      expect(result.id).toBe(created.id);
      expect(result.amount).toBe(100);
    });

    it('退款不存在应抛出 BusinessNotFoundException', async () => {
      await expect(
        runAsDoctor(() => service.findOne('non-existent'))
      ).rejects.toThrow(BusinessNotFoundException);
    });
  });
});
