import { Test, TestingModule } from '@nestjs/testing';
import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { MemberCardsService } from './member-cards.service';
import { DbService } from '../../../db/db.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { StatsService } from '../../system/stats/stats.service';
import { EventBusService } from '../../../common/events/event-bus.service';
import { MemberCardLogRepository } from './repositories/member-card-log.repository';
import { MemberPointLogRepository } from './repositories/member-point-log.repository';
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
  TEST_MEMBER_CARD_ID,
} from '../../../../test/factories';
import { yuanToCents, centsToYuan } from '../../../common/utils/format/money.utils';
import { MemberCardStatus, MemberCardLogType, PointLogType } from '../../../common/constants';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

describe('MemberCardsService - Integration', () => {
  let service: MemberCardsService;
  let clinicContext: ClinicContextService;
  let db: ReturnType<typeof createTestDb>;
  let module: TestingModule;

  const runAsStaff = <T>(fn: () => T | Promise<T>): T | Promise<T> =>
    runInClinicContext(
      clinicContext,
      { clinicId: TEST_CLINIC_ID, userId: 'test-user-001', role: 'BOSS' },
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
        MemberCardLogRepository,
        MemberPointLogRepository,
        { provide: StatsService, useValue: { invalidateStatsCache: jest.fn() } },
        { provide: EventBusService, useValue: { emit: jest.fn(), on: jest.fn(), onAll: jest.fn() } },
        MemberCardsService,
      ],
    }).compile();

    service = module.get(MemberCardsService);
    clinicContext = module.get(ClinicContextService);
  });

  afterEach(() => {
    cleanupTestDb(db);
  });

  describe('会员卡余额计算', () => {
    it('充值应正确增加余额和累计充值金额', async () => {
      const initialBalance = yuanToCents(1000);
      const initialRecharge = yuanToCents(1000);

      const result = await runAsStaff(() =>
        service.recharge(TEST_MEMBER_CARD_ID, 500),
      );

      expect(result.balance).toBe(centsToYuan(initialBalance + yuanToCents(500)));

      const row = db.prepare(
        'SELECT balance, totalRecharge, totalConsume FROM MemberCard WHERE id = ?',
      ).get(TEST_MEMBER_CARD_ID) as { balance: number; totalRecharge: number; totalConsume: number };

      expect(row.balance).toBe(initialBalance + yuanToCents(500));
      expect(row.totalRecharge).toBe(initialRecharge + yuanToCents(500));
      expect(row.totalConsume).toBe(0);
    });

    it('消费应正确扣减余额并增加累计消费', async () => {
      const result = await runAsStaff(() =>
        service.consume(TEST_MEMBER_CARD_ID, 300),
      );

      expect(result.balance).toBe(centsToYuan(yuanToCents(1000) - yuanToCents(300)));
      expect(result.totalConsume).toBe(centsToYuan(yuanToCents(300)));

      const row = db.prepare(
        'SELECT balance, totalRecharge, totalConsume FROM MemberCard WHERE id = ?',
      ).get(TEST_MEMBER_CARD_ID) as { balance: number; totalRecharge: number; totalConsume: number };

      expect(row.balance).toBe(yuanToCents(1000) - yuanToCents(300));
      expect(row.totalRecharge).toBe(yuanToCents(1000));
      expect(row.totalConsume).toBe(yuanToCents(300));
    });

    it('退款应正确回滚余额和累计消费', async () => {
      await runAsStaff(() => service.consume(TEST_MEMBER_CARD_ID, 300));

      const afterConsume = db.prepare(
        'SELECT balance, totalConsume FROM MemberCard WHERE id = ?',
      ).get(TEST_MEMBER_CARD_ID) as { balance: number; totalConsume: number };

      const result = await runAsStaff(() =>
        service.refund(TEST_MEMBER_CARD_ID, 100),
      );

      expect(result.balance).toBe(centsToYuan(afterConsume.balance + yuanToCents(100)));

      const row = db.prepare(
        'SELECT balance, totalConsume FROM MemberCard WHERE id = ?',
      ).get(TEST_MEMBER_CARD_ID) as { balance: number; totalConsume: number };

      expect(row.balance).toBe(afterConsume.balance + yuanToCents(100));
      expect(row.totalConsume).toBe(Math.max(0, afterConsume.totalConsume - yuanToCents(100)));
    });

    it('多次操作后余额应正确累计', async () => {
      await runAsStaff(() => service.recharge(TEST_MEMBER_CARD_ID, 200));
      await runAsStaff(() => service.consume(TEST_MEMBER_CARD_ID, 150));
      await runAsStaff(() => service.recharge(TEST_MEMBER_CARD_ID, 100));
      await runAsStaff(() => service.consume(TEST_MEMBER_CARD_ID, 50));

      const row = db.prepare(
        'SELECT balance, totalRecharge, totalConsume FROM MemberCard WHERE id = ?',
      ).get(TEST_MEMBER_CARD_ID) as { balance: number; totalRecharge: number; totalConsume: number };

      const expectedBalance = yuanToCents(1000) + yuanToCents(200) - yuanToCents(150) + yuanToCents(100) - yuanToCents(50);
      expect(row.balance).toBe(expectedBalance);

      const expectedRecharge = yuanToCents(1000) + yuanToCents(200) + yuanToCents(100);
      expect(row.totalRecharge).toBe(expectedRecharge);

      const expectedConsume = yuanToCents(150) + yuanToCents(50);
      expect(row.totalConsume).toBe(expectedConsume);
    });

    it('消费金额超过余额应抛出 BusinessValidationException', async () => {
      await expect(
        runAsStaff(() => service.consume(TEST_MEMBER_CARD_ID, 2000)),
      ).rejects.toThrow(BusinessValidationException);

      const row = db.prepare(
        'SELECT balance FROM MemberCard WHERE id = ?',
      ).get(TEST_MEMBER_CARD_ID) as { balance: number };
      expect(row.balance).toBe(yuanToCents(1000));
    });

    it('对不存在的会员卡操作应抛出 BusinessNotFoundException', async () => {
      await expect(
        runAsStaff(() => service.consume('non-existent-card', 100)),
      ).rejects.toThrow(BusinessNotFoundException);
    });
  });

  describe('会员卡流水记录验证', () => {
    it('充值操作应写入 MemberCardLog', async () => {
      await runAsStaff(() => service.recharge(TEST_MEMBER_CARD_ID, 500));

      const logs = db.prepare(
        'SELECT * FROM MemberCardLog WHERE cardId = ? ORDER BY createdAt',
      ).all(TEST_MEMBER_CARD_ID) as any[];

      expect(logs.length).toBe(1);
      expect(logs[0].type).toBe(MemberCardLogType.RECHARGE);
      expect(logs[0].amount).toBe(yuanToCents(500));
      expect(logs[0].balanceAfter).toBe(yuanToCents(1500));
    });

    it('消费操作应写入 MemberCardLog 且类型为 CONSUME', async () => {
      await runAsStaff(() => service.consume(TEST_MEMBER_CARD_ID, 200));

      const logs = db.prepare(
        'SELECT * FROM MemberCardLog WHERE cardId = ? AND type = ?',
      ).all(TEST_MEMBER_CARD_ID, MemberCardLogType.CONSUME) as any[];

      expect(logs.length).toBe(1);
      expect(logs[0].amount).toBe(-yuanToCents(200));
      expect(logs[0].balanceAfter).toBe(yuanToCents(800));
    });

    it('退款操作应写入 MemberCardLog 且类型为 REFUND', async () => {
      await runAsStaff(() => service.consume(TEST_MEMBER_CARD_ID, 300));
      await runAsStaff(() => service.refund(TEST_MEMBER_CARD_ID, 100));

      const logs = db.prepare(
        'SELECT * FROM MemberCardLog WHERE cardId = ? AND type = ?',
      ).all(TEST_MEMBER_CARD_ID, MemberCardLogType.REFUND) as any[];

      expect(logs.length).toBe(1);
      expect(logs[0].amount).toBe(yuanToCents(100));
    });

    it('连续操作的流水应按时间顺序排列', async () => {
      await runAsStaff(() => service.recharge(TEST_MEMBER_CARD_ID, 200));
      await runAsStaff(() => service.consume(TEST_MEMBER_CARD_ID, 100));
      await runAsStaff(() => service.refund(TEST_MEMBER_CARD_ID, 50));

      const logs = db.prepare(
        'SELECT type, balanceAfter FROM MemberCardLog WHERE cardId = ? ORDER BY createdAt',
      ).all(TEST_MEMBER_CARD_ID) as any[];

      expect(logs.length).toBe(3);
      expect(logs[0].type).toBe(MemberCardLogType.RECHARGE);
      expect(logs[1].type).toBe(MemberCardLogType.CONSUME);
      expect(logs[2].type).toBe(MemberCardLogType.REFUND);

      expect(logs[0].balanceAfter).toBe(yuanToCents(1200));
      expect(logs[1].balanceAfter).toBe(yuanToCents(1100));
      expect(logs[2].balanceAfter).toBe(yuanToCents(1150));
    });
  });

  describe('会员卡积分计算', () => {
    it('addPoints 应正确增加积分并写入日志', async () => {
      const result = await runAsStaff(() =>
        service.addPoints(TEST_MEMBER_CARD_ID, 100),
      );

      expect(result.points).toBe(100);

      const row = db.prepare(
        'SELECT points FROM MemberCard WHERE id = ?',
      ).get(TEST_MEMBER_CARD_ID) as { points: number };
      expect(row.points).toBe(100);

      const logs = db.prepare(
        'SELECT * FROM MemberPointLog WHERE cardId = ? AND type = ?',
      ).all(TEST_MEMBER_CARD_ID, PointLogType.ADD) as any[];
      expect(logs.length).toBe(1);
      expect(logs[0].points).toBe(100);
      expect(logs[0].balanceAfter).toBe(100);
    });

    it('deductPoints 应正确扣减积分', async () => {
      await runAsStaff(() => service.addPoints(TEST_MEMBER_CARD_ID, 200));
      await runAsStaff(() => service.deductPoints(TEST_MEMBER_CARD_ID, 50));

      const row = db.prepare(
        'SELECT points FROM MemberCard WHERE id = ?',
      ).get(TEST_MEMBER_CARD_ID) as { points: number };
      expect(row.points).toBe(150);

      const logs = db.prepare(
        'SELECT * FROM MemberPointLog WHERE cardId = ? AND type = ?',
      ).all(TEST_MEMBER_CARD_ID, PointLogType.DEDUCT) as any[];
      expect(logs.length).toBe(1);
      expect(logs[0].points).toBe(-50);
    });

    it('积分不足时 deductPoints 应抛出 BusinessValidationException', async () => {
      await runAsStaff(() => service.addPoints(TEST_MEMBER_CARD_ID, 50));

      await expect(
        runAsStaff(() => service.deductPoints(TEST_MEMBER_CARD_ID, 100)),
      ).rejects.toThrow(BusinessValidationException);

      const row = db.prepare(
        'SELECT points FROM MemberCard WHERE id = ?',
      ).get(TEST_MEMBER_CARD_ID) as { points: number };
      expect(row.points).toBe(50);
    });

    it('积分为负数的操作应被拒绝', async () => {
      await expect(
        runAsStaff(() => service.addPoints(TEST_MEMBER_CARD_ID, -10)),
      ).rejects.toThrow(BusinessValidationException);

      await expect(
        runAsStaff(() => service.deductPoints(TEST_MEMBER_CARD_ID, -5)),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('多次积分操作后应正确累计', async () => {
      await runAsStaff(() => service.addPoints(TEST_MEMBER_CARD_ID, 100));
      await runAsStaff(() => service.addPoints(TEST_MEMBER_CARD_ID, 50));
      await runAsStaff(() => service.deductPoints(TEST_MEMBER_CARD_ID, 30));

      const row = db.prepare(
        'SELECT points FROM MemberCard WHERE id = ?',
      ).get(TEST_MEMBER_CARD_ID) as { points: number };
      expect(row.points).toBe(120);

      const totalAdd = db.prepare(
        'SELECT SUM(points) as total FROM MemberPointLog WHERE cardId = ? AND type = ?',
      ).get(TEST_MEMBER_CARD_ID, PointLogType.ADD) as { total: number };
      expect(totalAdd.total).toBe(150);

      const totalDeduct = db.prepare(
        'SELECT SUM(points) as total FROM MemberPointLog WHERE cardId = ? AND type = ?',
      ).get(TEST_MEMBER_CARD_ID, PointLogType.DEDUCT) as { total: number };
      expect(totalDeduct.total).toBe(-30);
    });
  });

  describe('findByPatient + getLogs', () => {
    it('findByPatient 应返回正确的会员卡信息', async () => {
      const result = await runAsStaff(() => service.findByPatient(TEST_PATIENT_ID));

      expect(result).toBeDefined();
      expect(result!.patientId).toBe(TEST_PATIENT_ID);
      expect(result!.balance).toBe(centsToYuan(yuanToCents(1000)));
      expect(result!.status).toBe(MemberCardStatus.ACTIVE);
    });

    it('getLogs 应返回按时间倒序的流水列表', async () => {
      await runAsStaff(() => service.recharge(TEST_MEMBER_CARD_ID, 500));
      await sleep(10);
      await runAsStaff(() => service.consume(TEST_MEMBER_CARD_ID, 200));

      const logs = await runAsStaff(() => service.getLogs(TEST_MEMBER_CARD_ID));

      expect(logs.length).toBe(2);
      expect(logs[0].type).toBe(MemberCardLogType.CONSUME);
      expect(logs[1].type).toBe(MemberCardLogType.RECHARGE);
    });
  });

  describe('会员卡状态管理', () => {
    it('DISABLED 状态的卡不应允许充值', async () => {
      db.prepare(
        'UPDATE MemberCard SET status = ? WHERE id = ?',
      ).run(MemberCardStatus.DISABLED, TEST_MEMBER_CARD_ID);

      await expect(
        runAsStaff(() => service.recharge(TEST_MEMBER_CARD_ID, 100)),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('DISABLED 状态的卡不应允许消费', async () => {
      db.prepare(
        'UPDATE MemberCard SET status = ? WHERE id = ?',
      ).run(MemberCardStatus.DISABLED, TEST_MEMBER_CARD_ID);

      await expect(
        runAsStaff(() => service.consume(TEST_MEMBER_CARD_ID, 100)),
      ).rejects.toThrow(BusinessValidationException);
    });

    it('FROZEN 状态的卡消费应失败', async () => {
      db.prepare(
        'UPDATE MemberCard SET status = ? WHERE id = ?',
      ).run(MemberCardStatus.FROZEN, TEST_MEMBER_CARD_ID);

      await expect(
        runAsStaff(() => service.consume(TEST_MEMBER_CARD_ID, 100)),
      ).rejects.toThrow(BusinessValidationException);
    });
  });
});