import { Test, TestingModule } from '@nestjs/testing';
import { ChargePaymentService } from './charge-payment.service';
import { ChargeService } from './charge.service';
import { MemberCardsService } from '../member-cards/member-cards.service';
import { MemberPointLogRepository } from '../member-cards/repositories/member-point-log.repository';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { CacheService } from '../../../common/services/cache.service';
import { StatsService } from '../../system/stats/stats.service';
import {
  createTestDb,
  cleanupTestDb,
  createTestDbService,
  runInClinicContext,
  seedTestData,
} from '../../../db/test-helpers';
import {
  runConcurrently,
  runConcurrentTest,
  measureExecutionTime,
} from '../../../common/test-helpers/concurrent-test-utils';
import Database from 'better-sqlite3';
import * as crypto from 'node:crypto';

describe('ChargePaymentService - 并发测试', () => {
  let module: TestingModule;
  let db: Database.Database;
  let _dbService: DbService;
  let service: ChargePaymentService;
  let _chargeService: ChargeService;
  let clinicContext: ClinicContextService;

  const TEST_CLINIC_ID = 'test-clinic-001';
  const TEST_USER_ID = 'test-user-001';

  beforeAll(async () => {
    db = createTestDb();
    const testDbService = createTestDbService(db);

    module = await Test.createTestingModule({
      providers: [
        { provide: DbService, useValue: testDbService },
        ClinicContextService,
        IdempotencyService,
        CacheService,
        { provide: StatsService, useValue: { invalidateStatsCache: jest.fn() } },
        {
          provide: MemberPointLogRepository,
          useValue: { insert: jest.fn() },
        },
        {
          provide: MemberCardsService,
          useValue: {
            consume: jest.fn().mockResolvedValue({}),
            refund: jest.fn().mockResolvedValue({}),
            recharge: jest.fn().mockResolvedValue({}),
          },
        },
        ChargeService,
        ChargePaymentService,
      ],
    }).compile();

    service = module.get(ChargePaymentService);
    clinicContext = module.get(ClinicContextService);

    seedTestData(db);
  });

  afterAll(async () => {
    await module.close();
    cleanupTestDb(db);
  });

  beforeEach(() => {
    db.pragma('foreign_keys = OFF');
    db.prepare('DELETE FROM ChargeItem').run();
    db.prepare('DELETE FROM Charge').run();
    db.prepare('DELETE FROM MemberCardLog').run();
    db.prepare('DELETE FROM MemberCard').run();
    db.prepare('DELETE FROM IdempotencyRecord').run();
    db.prepare('DELETE FROM Patient').run();
    db.pragma('foreign_keys = ON');
  });

  function runInContext<T>(fn: () => T): T {
    return runInClinicContext(
      clinicContext,
      { clinicId: TEST_CLINIC_ID, userId: TEST_USER_ID, role: 'BOSS' },
      fn,
    );
  }

  function createPatient(): string {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(
      id,
      'P' + Date.now().toString().slice(-6) + Math.random().toString().slice(2, 4),
      '测试患者',
      'MALE',
      '138' + Math.random().toString().slice(2, 10),
      TEST_CLINIC_ID,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    return id;
  }

  function createCharge(patientId: string, totalAmountCents: number): string {
    const id = crypto.randomUUID();
    const number = 'C' + Date.now() + Math.random().toString().slice(2, 6);
    db.prepare(
      `INSERT INTO Charge (id, patientId, number, totalAmount, paidAmount, refundedAmount, discount, status, clinicId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, 0, 0, 0, 'UNPAID', ?, ?, ?)`
    ).run(
      id,
      patientId,
      number,
      totalAmountCents,
      TEST_CLINIC_ID,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    return id;
  }

  function createMemberCard(patientId: string, balanceCents: number): string {
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO MemberCard (id, patientId, cardNo, balance, totalRecharge, totalConsume, status, clinicId, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, 0, 'ACTIVE', ?, ?, ?)`
    ).run(
      id,
      patientId,
      'MC' + Date.now(),
      balanceCents,
      balanceCents,
      TEST_CLINIC_ID,
      new Date().toISOString(),
      new Date().toISOString(),
    );
    return id;
  }

  function getCharge(chargeId: string): { paidAmount: number; status: string } | undefined {
    const row = db.prepare(
      'SELECT paidAmount, status FROM Charge WHERE id = ? AND clinicId = ?'
    ).get(chargeId, TEST_CLINIC_ID) as { paidAmount: number; status: string } | undefined;
    return row;
  }

  function getMemberCard(cardId: string): { balance: number } | undefined {
    const row = db.prepare(
      'SELECT balance FROM MemberCard WHERE id = ? AND clinicId = ?'
    ).get(cardId, TEST_CLINIC_ID) as { balance: number } | undefined;
    return row;
  }

  function getIdempotencyRecordCount(): number {
    const row = db.prepare(
      'SELECT COUNT(*) as count FROM IdempotencyRecord'
    ).get() as { count: number };
    return row.count;
  }

  describe('乐观锁验证 - 防止超付', () => {
    it('支付金额超过待付金额时应失败（乐观锁 WHERE 条件验证）', async () => {
      const patientId = createPatient();
      const chargeId = createCharge(patientId, 30000);

      await runInContext(async () => {
        await service.payCharge(chargeId, {
          amount: 200,
          payMethod: 'CASH',
        });
      });

      const charge = getCharge(chargeId);
      expect(charge.paidAmount).toBe(20000);

      await expect(
        runInContext(async () => {
          await service.payCharge(chargeId, {
            amount: 200,
            payMethod: 'CASH',
          });
        }),
      ).rejects.toThrow();

      const chargeAfter = getCharge(chargeId);
      expect(chargeAfter.paidAmount).toBe(20000);
    });

    it('逐次部分支付直到结清，最后一次超额支付应失败', async () => {
      const patientId = createPatient();
      const chargeId = createCharge(patientId, 50000);

      await runInContext(async () => {
        await service.payCharge(chargeId, { amount: 200, payMethod: 'CASH' });
      });
      await runInContext(async () => {
        await service.payCharge(chargeId, { amount: 200, payMethod: 'CASH' });
      });

      const charge = getCharge(chargeId);
      expect(charge.paidAmount).toBe(40000);
      expect(charge.status).toBe('PARTIAL');

      await expect(
        runInContext(async () => {
          await service.payCharge(chargeId, { amount: 200, payMethod: 'CASH' });
        }),
      ).rejects.toThrow();

      const chargeAfter = getCharge(chargeId);
      expect(chargeAfter.paidAmount).toBe(40000);
    });

    it('已结清的收费单再次支付应失败', async () => {
      const patientId = createPatient();
      const chargeId = createCharge(patientId, 30000);

      await runInContext(async () => {
        await service.payCharge(chargeId, { amount: 300, payMethod: 'CASH' });
      });

      const charge = getCharge(chargeId);
      expect(charge.status).toBe('PAID');

      await expect(
        runInContext(async () => {
          await service.payCharge(chargeId, { amount: 100, payMethod: 'CASH' });
        }),
      ).rejects.toThrow('该收费已结清');
    });
  });

  describe('并发执行验证 - 同步数据库串行执行', () => {
    it('并发多次部分支付应全部成功（同步数据库串行执行，无竞争）', async () => {
      const patientId = createPatient();
      const chargeId = createCharge(patientId, 50000); // 500 元
      const concurrentCount = 10;
      const payAmount = 50; // 每次 50 元

      const result = await runConcurrentTest(
        concurrentCount,
        async () => {
          return runInContext(async () => {
            return service.payCharge(chargeId, {
              amount: payAmount,
              payMethod: 'CASH',
            });
          });
        },
        concurrentCount,
      );

      expect(result.successCount).toBe(concurrentCount);
      expect(result.failureCount).toBe(0);

      const charge = getCharge(chargeId);
      expect(charge.paidAmount).toBe(concurrentCount * payAmount * 100);
      expect(charge.status).toBe('PAID');
    });

    it('并发支付性能测试 - 测量 100 次支付的执行时间', async () => {
      const patientId = createPatient();
      const chargeId = createCharge(patientId, 10000000); // 10 万元
      const count = 100;

      const { durationMs } = await measureExecutionTime(async () => {
        await runConcurrentTest(
          count,
          async (_i) => {
            return runInContext(async () => {
              return service.payCharge(chargeId, {
                amount: 1,
                payMethod: 'CASH',
              });
            });
          },
          count,
        );
      });

      const charge = getCharge(chargeId);
      expect(charge.paidAmount).toBe(count * 100);
      expect(durationMs).toBeGreaterThan(0);
    }, 10000);
  });

  describe('会员卡并发支付 - 余额保护', () => {
    it('会员卡余额不足时支付应失败', async () => {
      const patientId = createPatient();
      const chargeId = createCharge(patientId, 100000);
      const cardId = createMemberCard(patientId, 5000);

      await expect(
        runInContext(async () => {
          await service.payCharge(chargeId, {
            amount: 100,
            payMethod: 'MEMBER_CARD',
            memberCardId: cardId,
          });
        }),
      ).rejects.toThrow('会员卡余额不足');

      const card = getMemberCard(cardId);
      expect(card.balance).toBe(5000);
    });

    it('并发会员卡支付全部成功（同步数据库串行执行）', async () => {
      const patientId = createPatient();
      const chargeId = createCharge(patientId, 1000000);
      const cardId = createMemberCard(patientId, 500000);
      const count = 5;

      const result = await runConcurrentTest(
        count,
        async () => {
          return runInContext(async () => {
            return service.payCharge(chargeId, {
              amount: 50,
              payMethod: 'MEMBER_CARD',
              memberCardId: cardId,
            });
          });
        },
        count,
      );

      expect(result.successCount).toBe(count);
      const card = getMemberCard(cardId);
      expect(card.balance).toBe(500000 - count * 5000);
    });

    it('会员卡余额扣减后余额为 0 时后续支付失败', async () => {
      const patientId = createPatient();
      const chargeId = createCharge(patientId, 100000);
      const cardId = createMemberCard(patientId, 30000);

      await runInContext(async () => {
        await service.payCharge(chargeId, {
          amount: 300,
          payMethod: 'MEMBER_CARD',
          memberCardId: cardId,
        });
      });

      const card = getMemberCard(cardId);
      expect(card.balance).toBe(0);

      await expect(
        runInContext(async () => {
          await service.payCharge(chargeId, {
            amount: 100,
            payMethod: 'MEMBER_CARD',
            memberCardId: cardId,
          });
        }),
      ).rejects.toThrow();
    });
  });

  describe('幂等性验证', () => {
    it('相同 requestId 的多次支付只生效一次（幂等性）', async () => {
      const patientId = createPatient();
      const chargeId = createCharge(patientId, 30000);
      const requestId = 'test-idempotent-' + Date.now();

      const result1 = await runInContext(async () => {
        return service.payCharge(chargeId, {
          amount: 300,
          payMethod: 'CASH',
          requestId,
        });
      });

      expect(result1).toBeDefined();

      const result2 = await runInContext(async () => {
        return service.payCharge(chargeId, {
          amount: 300,
          payMethod: 'CASH',
          requestId,
        });
      });

      expect(result2).toBeDefined();

      const charge = getCharge(chargeId);
      expect(charge.paidAmount).toBe(30000);
      expect(charge.status).toBe('PAID');

      const idempotencyCount = getIdempotencyRecordCount();
      expect(idempotencyCount).toBe(1);
    });

    it('不同 requestId 的支付各自独立执行', async () => {
      const patientId = createPatient();
      const chargeId = createCharge(patientId, 50000);

      await runInContext(async () => {
        return service.payCharge(chargeId, {
          amount: 100,
          payMethod: 'CASH',
          requestId: 'req-1',
        });
      });

      await runInContext(async () => {
        return service.payCharge(chargeId, {
          amount: 100,
          payMethod: 'CASH',
          requestId: 'req-2',
        });
      });

      const charge = getCharge(chargeId);
      expect(charge.paidAmount).toBe(20000);
      expect(charge.status).toBe('PARTIAL');

      const idempotencyCount = getIdempotencyRecordCount();
      expect(idempotencyCount).toBe(2);
    });

    it('并发相同 requestId 的支付请求，幂等性保证只执行一次', async () => {
      const patientId = createPatient();
      const chargeId = createCharge(patientId, 30000);
      const requestId = 'concurrent-idempotent-' + Date.now();
      const concurrentCount = 5;

      const results = await runConcurrently(
        Array.from({ length: concurrentCount }, () => async () => {
          return runInContext(async () => {
            try {
              await service.payCharge(chargeId, {
                amount: 300,
                payMethod: 'CASH',
                requestId,
              });
              return 'success';
            } catch {
              return 'failed';
            }
          });
        }),
      );

      const charge = getCharge(chargeId);
      expect(charge.paidAmount).toBe(30000);
      expect(charge.status).toBe('PAID');

      const successCount = results.filter((r) => r === 'success').length;
      expect(successCount).toBeGreaterThanOrEqual(1);

      const idempotencyCount = getIdempotencyRecordCount();
      expect(idempotencyCount).toBe(1);
    });
  });

  describe('混合支付场景', () => {
    it('现金和会员卡混合支付，总金额正确', async () => {
      const patientId = createPatient();
      const chargeId = createCharge(patientId, 50000);
      const cardId = createMemberCard(patientId, 30000);

      await runInContext(async () => {
        await service.payCharge(chargeId, {
          amount: 200,
          payMethod: 'CASH',
        });
      });

      await runInContext(async () => {
        await service.payCharge(chargeId, {
          amount: 200,
          payMethod: 'MEMBER_CARD',
          memberCardId: cardId,
        });
      });

      const charge = getCharge(chargeId);
      expect(charge.paidAmount).toBe(40000);
      expect(charge.status).toBe('PARTIAL');

      const card = getMemberCard(cardId);
      expect(card.balance).toBe(10000);
    });

    it('并发混合支付（同步数据库串行执行，全部成功）', async () => {
      const patientId = createPatient();
      const chargeId = createCharge(patientId, 100000);
      const cardId = createMemberCard(patientId, 50000);
      const cashCount = 3;
      const cardCount = 3;
      const amountPerPay = 50;

      const tasks: (() => Promise<string>)[] = [];

      for (let i = 0; i < cashCount; i++) {
        tasks.push(async () => {
          return runInContext(async () => {
            try {
              await service.payCharge(chargeId, {
                amount: amountPerPay,
                payMethod: 'CASH',
              });
              return 'cash-success';
            } catch {
              return 'cash-failed';
            }
          });
        });
      }

      for (let i = 0; i < cardCount; i++) {
        tasks.push(async () => {
          return runInContext(async () => {
            try {
              await service.payCharge(chargeId, {
                amount: amountPerPay,
                payMethod: 'MEMBER_CARD',
                memberCardId: cardId,
              });
              return 'card-success';
            } catch {
              return 'card-failed';
            }
          });
        });
      }

      const shuffled = [...tasks].sort(() => Math.random() - 0.5);
      const results = await runConcurrently(shuffled);

      const cashSuccess = results.filter((r) => r === 'cash-success').length;
      const cardSuccess = results.filter((r) => r === 'card-success').length;

      expect(cashSuccess).toBe(cashCount);
      expect(cardSuccess).toBe(cardCount);

      const charge = getCharge(chargeId);
      const totalPaidCents = (cashSuccess + cardSuccess) * amountPerPay * 100;
      expect(charge.paidAmount).toBe(totalPaidCents);

      const card = getMemberCard(cardId);
      expect(card.balance).toBe(50000 - cardSuccess * amountPerPay * 100);
    });
  });
});
