import { Test, TestingModule } from '@nestjs/testing';
import { BusinessValidationException } from '@common/errors';

import { RefundsService } from './refunds/refunds.service';
import { ChargeService } from './charge/charge.service';
import { ChargePaymentService } from './charge/charge-payment.service';
import { DebtService } from './charge/debt.service';
import { ComboService } from './charge/combo.service';
import { PaymentMethodService } from './charge/payment-method.service';
import { MemberCardsService } from './member-cards/member-cards.service';
import { ChargeRepository } from './charge/repositories/charge.repository';
import { RefundRepository } from './refunds/repositories/refund.repository';
import { MemberCardLogRepository } from './member-cards/repositories/member-card-log.repository';
import { MemberPointLogRepository } from './member-cards/repositories/member-point-log.repository';
import { DbService } from '../../db/db.service';
import { IdempotencyService } from '../../common/services/idempotency.service';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { CacheService } from '../../common/services/cache.service';
import { StatsService } from '../system/stats/stats.service';
import { EventBusService } from '../../common/events/event-bus.service';
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
  TEST_MEMBER_CARD_ID,
} from '../../../test/factories';

/**
 * 财务核心流程 E2E 测试
 *
 * 覆盖「收费 → 退款 → 欠款同步 → 会员卡退款」完整链路，
 * 验证各环节数据状态与事务一致性。
 *
 * 金额约定：
 * - DB 存分（INTEGER），如 1000 元 = 100000 分
 * - service 调用传元，返回值也是元
 * - 直接查 DB 验证用分
 */
describe('Financial Flow E2E - 收费→退款→欠款同步→会员卡退款', () => {
  let refundsService: RefundsService;
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
        RefundRepository,
        RefundsService,
      ],
    }).compile();

    refundsService = module.get(RefundsService);
    chargeService = module.get(ChargeService);
    chargePaymentService = module.get(ChargePaymentService);
    debtService = module.get(DebtService);
    clinicContext = module.get(ClinicContextService);
  });

  afterEach(() => {
    cleanupTestDb(db);
  });

  // 金额辅助：元 → 分（DB 存分）
  const C = (yuan: number) => yuan * 100;

  describe('完整流程', () => {
    it('收费→会员卡支付→欠款→退款 全链路状态一致', async () => {
      // ================================================================
      // Step 1: 验证 seed 数据 — 患者与会员卡已就绪，会员卡余额 1000 元
      // ================================================================
      const seedCard = db.prepare('SELECT balance, totalRecharge, totalConsume, status FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;
      expect(seedCard.balance).toBe(C(1000));
      expect(seedCard.totalRecharge).toBe(C(1000));
      expect(seedCard.totalConsume).toBe(0);
      expect(seedCard.status).toBe('ACTIVE');

      const seedPatient = db.prepare('SELECT id, name FROM Patient WHERE id = ?').get(TEST_PATIENT_ID) as any;
      expect(seedPatient).toBeDefined();

      // ================================================================
      // Step 2: 创建收费单 — 总额 500 元，含 2 个收费项
      // ================================================================
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [
            { name: '洗牙', category: '基础护理', price: 300, quantity: 1 },
            { name: '补牙', category: '修复', price: 200, quantity: 1 },
          ],
        }),
      );

      expect(charge.id).toBeDefined();
      expect(charge.totalAmount).toBe(500);
      expect(charge.paidAmount).toBe(0);
      expect(charge.refundedAmount).toBe(0);
      expect(charge.status).toBe('UNPAID');
      expect(charge.items.length).toBe(2);

      const chargeRow = db.prepare('SELECT totalAmount, paidAmount, refundedAmount, status FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(chargeRow.totalAmount).toBe(C(500));
      expect(chargeRow.paidAmount).toBe(0);
      expect(chargeRow.status).toBe('UNPAID');

      // ================================================================
      // Step 3: 会员卡支付 300 元 → 余额 700，收费单 paidAmount=300
      // ================================================================
      const payResult = await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 300,
          payMethod: 'MEMBER_CARD',
          memberCardId: TEST_MEMBER_CARD_ID,
        }),
      );

      expect(payResult.paidAmount).toBe(300);
      expect(payResult.status).toBe('PARTIAL');

      const cardAfterPay = db.prepare('SELECT balance, totalConsume FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;
      expect(cardAfterPay.balance).toBe(C(700));
      expect(cardAfterPay.totalConsume).toBe(C(300));

      const chargeAfterPay = db.prepare('SELECT paidAmount, refundedAmount, status, payMethod FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(chargeAfterPay.paidAmount).toBe(C(300));
      expect(chargeAfterPay.refundedAmount).toBe(0);
      expect(chargeAfterPay.status).toBe('PARTIAL');
      expect(chargeAfterPay.payMethod).toBe('MEMBER_CARD');

      // ================================================================
      // Step 4: 创建欠款记录（欠 200 元）— totalAmount=500, debtAmount=200
      // ================================================================
      const debt = await runAsDoctor(() =>
        debtService.createDebtFromCharge({
          chargeId: charge.id,
          patientId: TEST_PATIENT_ID,
          totalAmount: 500,
          debtAmount: 200,
        }),
      );

      expect(debt.totalAmount).toBe(500);
      expect(debt.paidAmount).toBe(300);
      expect(debt.debtAmount).toBe(200);
      expect(debt.status).toBe('PARTIAL');

      const debtRow = db.prepare('SELECT totalAmount, paidAmount, debtAmount, status FROM DebtRecord WHERE id = ?').get(debt.id) as any;
      expect(debtRow.totalAmount).toBe(C(500));
      expect(debtRow.paidAmount).toBe(C(300));
      expect(debtRow.debtAmount).toBe(C(200));
      expect(debtRow.status).toBe('PARTIAL');

      // ================================================================
      // Step 5: 退款 100 元 → 退到会员卡
      // 验证：会员卡余额 800（700+100）
      // 验证：收费单 refundedAmount=100
      // 验证：欠款记录 paidAmount 相应调整
      // ================================================================
      const refundResult = await runAsDoctor(() =>
        refundsService.createRefund(
          { chargeId: charge.id, amount: 100, reason: '部分退款' },
          { id: TEST_DOCTOR_ID, name: '张医生', ip: '127.0.0.1' },
        ),
      );

      expect(refundResult.id).toBeDefined();
      expect(refundResult.amount).toBe(100);
      expect(refundResult.memberCard).toBeDefined();
      expect(refundResult.memberCard.cardId).toBe(TEST_MEMBER_CARD_ID);
      expect(refundResult.memberCard.refundedAmount).toBe(100);
      expect(refundResult.memberCard.balanceAfter).toBe(800);
      expect(refundResult.debt).toBeDefined();
      expect(refundResult.debt.debtId).toBe(debt.id);

      // 会员卡：余额 800，totalConsume 回滚到 200
      const cardAfterRefund = db.prepare('SELECT balance, totalConsume FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;
      expect(cardAfterRefund.balance).toBe(C(800));
      expect(cardAfterRefund.totalConsume).toBe(C(200));

      // 收费单：refundedAmount=100，状态仍为 PARTIAL（已付 300 < 总额 500）
      const chargeAfterRefund = db.prepare('SELECT paidAmount, refundedAmount, status FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(chargeAfterRefund.paidAmount).toBe(C(300));
      expect(chargeAfterRefund.refundedAmount).toBe(C(100));
      expect(chargeAfterRefund.status).toBe('PARTIAL');

      // 退款记录
      const refundRow = db.prepare('SELECT amount, reason, operatorId, operatorName FROM Refund WHERE id = ?').get(refundResult.id) as any;
      expect(refundRow.amount).toBe(C(100));
      expect(refundRow.reason).toBe('部分退款');
      expect(refundRow.operatorId).toBe(TEST_DOCTOR_ID);
      expect(refundRow.operatorName).toBe('张医生');

      // 欠款记录：paidAmount 从 300 减到 200，debtAmount 从 200 增到 300
      const debtAfterRefund = db.prepare('SELECT paidAmount, debtAmount, status FROM DebtRecord WHERE id = ?').get(debt.id) as any;
      expect(debtAfterRefund.paidAmount).toBe(C(200));
      expect(debtAfterRefund.debtAmount).toBe(C(300));
      expect(debtAfterRefund.status).toBe('PARTIAL');

      // ================================================================
      // Step 6: 验证审计日志已记录
      // ================================================================
      const auditLogs = db.prepare("SELECT * FROM AuditLog WHERE targetId = ? AND type = 'REFUND'").all(charge.id) as any[];
      expect(auditLogs.length).toBe(1);
      expect(auditLogs[0].targetType).toBe('Charge');
      expect(auditLogs[0].operatorId).toBe(TEST_DOCTOR_ID);
      expect(auditLogs[0].operatorName).toBe('张医生');
      expect(auditLogs[0].amount).toBe(100);
      expect(auditLogs[0].remark).toBe('部分退款');
      expect(auditLogs[0].ip).toBe('127.0.0.1');
      expect(auditLogs[0].beforeData).toBeDefined();
      expect(auditLogs[0].afterData).toBeDefined();
    });

    it('退款后会员卡流水应包含消费与退款两条记录', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 500, quantity: 1 }],
        }),
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 300,
          payMethod: 'MEMBER_CARD',
          memberCardId: TEST_MEMBER_CARD_ID,
        }),
      );

      await runAsDoctor(() =>
        refundsService.createRefund({ chargeId: charge.id, amount: 100, reason: '流水测试' }),
      );

      const logs = db.prepare('SELECT * FROM MemberCardLog WHERE cardId = ? ORDER BY createdAt').all(TEST_MEMBER_CARD_ID) as any[];
      expect(logs.length).toBe(2);
      expect(logs[0].type).toBe('CONSUME');
      expect(logs[0].amount).toBe(-C(300));
      expect(logs[0].balanceAfter).toBe(C(700));
      expect(logs[0].chargeId).toBe(charge.id);
      expect(logs[1].type).toBe('REFUND');
      expect(logs[1].amount).toBe(C(100));
      expect(logs[1].balanceAfter).toBe(C(800));
      expect(logs[1].chargeId).toBe(charge.id);
    });
  });

  describe('事务一致性', () => {
    it('退款超过可退额度时应抛出异常且不产生任何变更', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 500, quantity: 1 }],
        }),
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 300,
          payMethod: 'MEMBER_CARD',
          memberCardId: TEST_MEMBER_CARD_ID,
        }),
      );

      const cardBefore = db.prepare('SELECT balance, totalConsume FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;
      const chargeBefore = db.prepare('SELECT paidAmount, refundedAmount, status FROM Charge WHERE id = ?').get(charge.id) as any;

      // 退款 500 元超过可退金额 300 元 → 应抛出异常
      await expect(
        runAsDoctor(() => refundsService.createRefund({ chargeId: charge.id, amount: 500 })),
      ).rejects.toThrow(BusinessValidationException);

      // 会员卡余额未变
      const cardAfter = db.prepare('SELECT balance, totalConsume FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;
      expect(cardAfter.balance).toBe(cardBefore.balance);
      expect(cardAfter.totalConsume).toBe(cardBefore.totalConsume);

      // 收费单未变
      const chargeAfter = db.prepare('SELECT paidAmount, refundedAmount, status FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(chargeAfter.paidAmount).toBe(chargeBefore.paidAmount);
      expect(chargeAfter.refundedAmount).toBe(chargeBefore.refundedAmount);
      expect(chargeAfter.status).toBe(chargeBefore.status);

      // 无退款记录产生
      const refunds = db.prepare('SELECT * FROM Refund WHERE chargeId = ?').all(charge.id) as any[];
      expect(refunds.length).toBe(0);

      // 无审计日志产生
      const auditLogs = db.prepare("SELECT * FROM AuditLog WHERE targetId = ? AND type = 'REFUND'").all(charge.id) as any[];
      expect(auditLogs.length).toBe(0);
    });

    it('多次部分退款累计金额与状态正确', async () => {
      const charge = await runAsDoctor(() =>
        chargeService.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '正畸治疗', category: '正畸', price: 400, quantity: 1 }],
        }),
      );

      await runAsDoctor(() =>
        chargePaymentService.payCharge(charge.id, {
          amount: 400,
          payMethod: 'MEMBER_CARD',
          memberCardId: TEST_MEMBER_CARD_ID,
        }),
      );

      // 第一次退款 150 元
      await runAsDoctor(() =>
        refundsService.createRefund({ chargeId: charge.id, amount: 150, reason: '第一次退款' }),
      );

      let chargeRow = db.prepare('SELECT paidAmount, refundedAmount, status FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(chargeRow.refundedAmount).toBe(C(150));
      expect(chargeRow.status).toBe('PAID');

      let cardRow = db.prepare('SELECT balance, totalConsume FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;
      // 1000 - 400 + 150 = 750
      expect(cardRow.balance).toBe(C(750));
      // 400 - 150 = 250
      expect(cardRow.totalConsume).toBe(C(250));

      // 第二次退款 250 元（退完全部已付 400 元）
      await runAsDoctor(() =>
        refundsService.createRefund({ chargeId: charge.id, amount: 250, reason: '第二次退款' }),
      );

      chargeRow = db.prepare('SELECT paidAmount, refundedAmount, status FROM Charge WHERE id = ?').get(charge.id) as any;
      expect(chargeRow.refundedAmount).toBe(C(400));
      expect(chargeRow.status).toBe('REFUNDED');

      cardRow = db.prepare('SELECT balance, totalConsume FROM MemberCard WHERE id = ?').get(TEST_MEMBER_CARD_ID) as any;
      // 750 + 250 = 1000
      expect(cardRow.balance).toBe(C(1000));
      // 250 - 250 = 0
      expect(cardRow.totalConsume).toBe(0);

      // 退款记录应有 2 条
      const refunds = db.prepare('SELECT amount FROM Refund WHERE chargeId = ? ORDER BY createdAt').all(charge.id) as any[];
      expect(refunds.length).toBe(2);
      expect(refunds[0].amount).toBe(C(150));
      expect(refunds[1].amount).toBe(C(250));

      // 审计日志应有 2 条
      const auditLogs = db.prepare("SELECT * FROM AuditLog WHERE targetId = ? AND type = 'REFUND'").all(charge.id) as any[];
      expect(auditLogs.length).toBe(2);
    });
  });
});
