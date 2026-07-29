import { Test, TestingModule } from '@nestjs/testing';
import { BusinessValidationException } from '@common/errors';
import { ChargeService } from './charge.service';
import { ChargePaymentService } from './charge-payment.service';
import { MemberCardsService } from '../member-cards/member-cards.service';
import { MemberCardCoreService } from '../member-cards/member-card-core.service';
import { MemberCardBalanceService } from '../member-cards/member-card-balance.service';
import { MemberCardPointsService } from '../member-cards/member-card-points.service';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { StatsService } from '../../system/stats/stats.service';
import { EventBusService } from '../../../common/events/event-bus.service';
import { ChargeRepository } from './repositories/charge.repository';
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
} from '../../../../test/factories';
import { yuanToCents } from '../../../common/utils/format/money.utils';
import { ChargeStatus } from '../../../common/constants';
import * as crypto from 'node:crypto';

describe('ChargeService - Integration', () => {
  let service: ChargeService;
  let paymentService: ChargePaymentService;
  let clinicContext: ClinicContextService;
  let db: ReturnType<typeof createTestDb>;
  let module: TestingModule;

  const runAsDoctor = <T>(fn: () => T | Promise<T>): T | Promise<T> =>
    runInClinicContext(
      clinicContext,
      { clinicId: TEST_CLINIC_ID, userId: TEST_DOCTOR_ID, role: 'DOCTOR' },
      fn,
    );

  function createChargeDirect(
    patientId: string,
    items: { name: string; category: string; price: number; quantity: number }[],
    remark?: string,
    status: string = ChargeStatus.UNPAID,
  ): string {
    const chargeId = crypto.randomUUID();
    const now = new Date().toISOString();
    const totalCents = items.reduce(
      (sum, item) => sum + yuanToCents(item.price) * item.quantity,
      0,
    );

    db.prepare(
      `INSERT INTO Charge (id, patientId, doctorId, number, totalAmount, paidAmount, refundedAmount, discount, status, remark, clinicId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?, ?, ?)`,
    ).run(
      chargeId,
      patientId,
      TEST_DOCTOR_ID,
      'CHG' + Date.now() + Math.random().toString(36).slice(2, 6),
      totalCents,
      status,
      remark || null,
      TEST_CLINIC_ID,
      now,
      now,
    );

    for (const item of items) {
      const itemId = crypto.randomUUID();
      const priceCents = yuanToCents(item.price);
      const subtotalCents = priceCents * item.quantity;
      db.prepare(
        `INSERT INTO ChargeItem (id, chargeId, name, category, price, quantity, subtotal, clinicId)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        itemId,
        chargeId,
        item.name,
        item.category,
        priceCents,
        item.quantity,
        subtotalCents,
        TEST_CLINIC_ID,
      );
    }

    return chargeId;
  }

  beforeEach(async () => {
    db = createTestDb();
    seedTestData(db, { withMemberCard: true });

    const testDbService = createTestDbService(db);

    module = await Test.createTestingModule({
      providers: [
        { provide: DbService, useValue: testDbService },
        ClinicContextService,
        IdempotencyService,
        { provide: StatsService, useValue: { invalidateStatsCache: jest.fn() } },
        { provide: EventBusService, useValue: { emit: jest.fn(), on: jest.fn(), onAll: jest.fn() } },
        ChargeRepository,
        MemberCardLogRepository,
        MemberPointLogRepository,
        ChargeService,
        ChargePaymentService,
        // P0 修复：使用真实 MemberCardsService 实例，以支持 consumeSync 委托调用
        MemberCardCoreService,
        MemberCardBalanceService,
        MemberCardPointsService,
        MemberCardsService,
      ],
    }).compile();

    service = module.get(ChargeService);
    paymentService = module.get(ChargePaymentService);
    clinicContext = module.get(ClinicContextService);
  });

  afterEach(() => {
    cleanupTestDb(db);
  });

  describe('复杂 SQL 查询 - JOIN + 聚合 + 分页', () => {
    let chargeIds: string[];

    beforeEach(() => {
      chargeIds = [];
      const items = [
        { name: '超声波洁牙', category: '预防保健', price: 120, quantity: 1 },
        { name: '树脂补牙', category: '修复治疗', price: 200, quantity: 2 },
        { name: '根管治疗', category: '牙髓治疗', price: 500, quantity: 1 },
      ];
      for (let i = 0; i < 5; i++) {
        const id = createChargeDirect(TEST_PATIENT_ID, items, `测试收费-${i}`);
        chargeIds.push(id);
      }
    });

    it('listCharges 应正确分页返回并关联患者信息', async () => {
      const result = await runAsDoctor(() =>
        service.listCharges({ page: 1, pageSize: 3 }),
      );

      expect(result.total).toBe(5);
      expect(result.items.length).toBe(3);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(3);

      result.items.forEach((item: any) => {
        expect(item.patient).toBeDefined();
        expect(item.patient.id).toBe(TEST_PATIENT_ID);
        expect(item.patient.name).toBe('测试患者');
      });
    });

    it('listCharges 第二页数据应正确', async () => {
      const page1 = await runAsDoctor(() =>
        service.listCharges({ page: 1, pageSize: 2 }),
      );
      const page2 = await runAsDoctor(() =>
        service.listCharges({ page: 2, pageSize: 2 }),
      );
      const page3 = await runAsDoctor(() =>
        service.listCharges({ page: 3, pageSize: 2 }),
      );

      expect(page1.items.length).toBe(2);
      expect(page2.items.length).toBe(2);
      expect(page3.items.length).toBe(1);
      expect(page1.total).toBe(5);

      const page1Ids = page1.items.map((i: any) => i.id);
      const page2Ids = page2.items.map((i: any) => i.id);
      const intersection = page1Ids.filter((id: string) => page2Ids.includes(id));
      expect(intersection.length).toBe(0);
    });

    it('按患者 ID 过滤应仅返回该患者的记录', async () => {
      const result = await runAsDoctor(() =>
        service.listCharges({ patientId: TEST_PATIENT_ID, page: 1, pageSize: 10 }),
      );

      expect(result.total).toBe(5);
      expect(result.items.length).toBe(5);
      result.items.forEach((item: any) => {
        expect(item.patientId).toBe(TEST_PATIENT_ID);
      });
    });

    it('按状态过滤应返回正确状态的记录', async () => {
      await runAsDoctor(() =>
        paymentService.payCharge(chargeIds[0], {
          amount: 120 + 400 + 500,
          payMethod: 'CASH',
        }),
      );

      const result = await runAsDoctor(() =>
        service.listCharges({ status: ChargeStatus.PAID, page: 1, pageSize: 10 }),
      );
      expect(result.total).toBeGreaterThanOrEqual(1);
      result.items.forEach((item: any) => {
        expect(item.status).toBe(ChargeStatus.PAID);
      });
    });

    it('空结果集应返回空列表和正确总数', async () => {
      const result = await runAsDoctor(() =>
        service.listCharges({
          patientId: 'non-existent-patient',
          page: 1,
          pageSize: 10,
        }),
      );

      expect(result.total).toBe(0);
      expect(result.items.length).toBe(0);
    });

    it('分页参数 pageSize=0 应使用默认分页大小', async () => {
      const result = await runAsDoctor(() =>
        service.listCharges({ page: 1, pageSize: 0 }),
      );
      expect(result.total).toBe(5);
      expect(result.items.length).toBe(5);
    });

    it('分页超出范围应返回空列表', async () => {
      const result = await runAsDoctor(() =>
        service.listCharges({ page: 100, pageSize: 10 }),
      );
      expect(result.total).toBe(5);
      expect(result.items.length).toBe(0);
    });
  });

  describe('getCharge - 详情查询（JOIN ChargeItem）', () => {
    it('应返回收费单及其所有明细项', async () => {
      const chargeId = createChargeDirect(TEST_PATIENT_ID, [
        { name: '洗牙', category: '基础护理', price: 300, quantity: 1 },
        { name: '补牙', category: '修复治疗', price: 200, quantity: 2 },
      ]);

      const detail = await runAsDoctor(() => service.getCharge(chargeId));

      expect(detail.id).toBe(chargeId);
      expect(detail.items.length).toBe(2);
      expect(detail.totalAmount).toBe(300 + 400);
      expect(detail.items[0].name).toBe('洗牙');
      expect(detail.items[1].name).toBe('补牙');
    });

    it('不存在的收费单应抛出 BusinessNotFoundException', async () => {
      let thrownError: Error | null = null;
      try {
        await runAsDoctor(() => service.getCharge('non-existent'));
      } catch (e) {
        thrownError = e as Error;
      }
      expect(thrownError).not.toBeNull();
      expect(thrownError!.message).toContain('收费记录不存在');
    });

    it('空明细的收费单应返回空 items 数组', async () => {
      const chargeId = createChargeDirect(TEST_PATIENT_ID, []);

      const detail = await runAsDoctor(() => service.getCharge(chargeId));

      expect(detail.items.length).toBe(0);
      expect(detail.totalAmount).toBe(0);
    });
  });

  describe('createCharge + payCharge 集成', () => {
    it('创建并全额支付后状态应为 PAID', async () => {
      const charge = await runAsDoctor(() =>
        service.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '洗牙', category: '基础护理', price: 300, quantity: 1 }],
        }),
      );

      expect(charge.status).toBe(ChargeStatus.UNPAID);

      await runAsDoctor(() =>
        paymentService.payCharge(charge.id, { amount: 300, payMethod: 'CASH' }),
      );

      const updated = db.prepare(
        'SELECT status, paidAmount FROM Charge WHERE id = ?',
      ).get(charge.id) as { status: string; paidAmount: number };

      expect(updated.status).toBe(ChargeStatus.PAID);
      expect(updated.paidAmount).toBe(30000);
    });

    it('部分支付后状态应为 PARTIAL', async () => {
      const charge = await runAsDoctor(() =>
        service.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '治疗', category: '治疗', price: 1000, quantity: 1 }],
        }),
      );

      await runAsDoctor(() =>
        paymentService.payCharge(charge.id, { amount: 300, payMethod: 'CASH' }),
      );

      const updated = db.prepare(
        'SELECT status, paidAmount FROM Charge WHERE id = ?',
      ).get(charge.id) as { status: string; paidAmount: number };

      expect(updated.status).toBe(ChargeStatus.PARTIAL);
      expect(updated.paidAmount).toBe(30000);
    });

    it('超额支付应抛出 BusinessValidationException', async () => {
      const charge = await runAsDoctor(() =>
        service.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '检查', category: '检查', price: 100, quantity: 1 }],
        }),
      );

      await expect(
        runAsDoctor(() =>
          paymentService.payCharge(charge.id, { amount: 500, payMethod: 'CASH' }),
        ),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('会员卡支付应扣减会员卡余额并写入日志', async () => {
      const initialBalance = (db.prepare(
        'SELECT balance FROM MemberCard WHERE id = ?',
      ).get('test-card-001') as { balance: number }).balance;

      const charge = await runAsDoctor(() =>
        service.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '项目', category: '测试', price: 200, quantity: 1 }],
        }),
      );

      await runAsDoctor(() =>
        paymentService.payCharge(charge.id, {
          amount: 200,
          payMethod: 'MEMBER_CARD',
          memberCardId: 'test-card-001',
        }),
      );

      const afterBalance = (db.prepare(
        'SELECT balance FROM MemberCard WHERE id = ?',
      ).get('test-card-001') as { balance: number }).balance;

      expect(afterBalance).toBe(initialBalance - 20000);

      const logs = db.prepare(
        'SELECT * FROM MemberCardLog WHERE cardId = ? AND type = ?',
      ).all('test-card-001', 'CONSUME');
      expect(logs.length).toBe(1);
      expect((logs[0] as any).chargeId).toBe(charge.id);
    });
  });

  describe('charge-payment 并发安全', () => {
    it('同一收费单并发支付应只有一个成功', async () => {
      const charge = await runAsDoctor(() =>
        service.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: '项目', category: '测试', price: 1000, quantity: 1 }],
        }),
      );

      const results = await Promise.allSettled(
        Array.from({ length: 5 }, () =>
          runAsDoctor(() =>
            paymentService.payCharge(charge.id, { amount: 1000, payMethod: 'CASH' }),
          ),
        ),
      );

      const successCount = results.filter((r) => r.status === 'fulfilled').length;
      expect(successCount).toBe(1);

      const finalStatus = (db.prepare(
        'SELECT status FROM Charge WHERE id = ?',
      ).get(charge.id) as { status: string }).status;
      expect(finalStatus).toBe(ChargeStatus.PAID);
    });
  });

  describe('SQL 参数化验证', () => {
    it('createCharge 应使用参数化 SQL 防止注入', async () => {
      const maliciousName = "Robert'); DROP TABLE Charge;--";

      const charge = await runAsDoctor(() =>
        service.createCharge({
          patientId: TEST_PATIENT_ID,
          items: [{ name: maliciousName, category: '测试', price: 100, quantity: 1 }],
        }),
      );

      const item = db.prepare(
        'SELECT name FROM ChargeItem WHERE chargeId = ?',
      ).get(charge.id) as { name: string };

      expect(item.name).toBe(maliciousName);

      const tableCheck = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'Charge'",
      ).get();
      expect(tableCheck).toBeDefined();
    });
  });
});