import { MemberCardLogRepository } from './member-card-log.repository';
import { MockDbService } from '../../../../db/__mocks__/db-service.mock';
import { MemberCardLogType } from '../../../../common/constants';
import { TEST_CLINIC_ID } from '../../../../../test/factories';

describe('MemberCardLogRepository', () => {
  let repo: MemberCardLogRepository;
  let db: MockDbService;

  beforeEach(() => {
    repo = new MemberCardLogRepository();
    db = new MockDbService();
  });

  afterEach(() => {
    db.clear();
  });

  describe('create', () => {
    it('创建会员卡流水记录', () => {
      const now = new Date().toISOString();
      const logId = repo.create(db, {
        cardId: 'card-001',
        type: MemberCardLogType.RECHARGE,
        amount: 10000,
        balanceAfter: 10000,
        clinicId: TEST_CLINIC_ID,
      }, now);

      expect(logId).toBeDefined();
      const logs = db.getTableData('MemberCardLog');
      expect(logs.length).toBe(1);
      expect(logs[0].cardId).toBe('card-001');
      expect(logs[0].type).toBe('RECHARGE');
      expect(logs[0].amount).toBe(10000);
      expect(logs[0].balanceAfter).toBe(10000);
      expect(logs[0].clinicId).toBe(TEST_CLINIC_ID);
      expect(logs[0].createdAt).toBe(now);
    });

    it('创建时不传 now 参数会自动生成', () => {
      const logId = repo.create(db, {
        cardId: 'card-001',
        type: MemberCardLogType.CONSUME,
        amount: -5000,
        balanceAfter: 5000,
        chargeId: 'charge-001',
        remark: '测试消费',
        clinicId: TEST_CLINIC_ID,
      });

      expect(logId).toBeDefined();
      const logs = db.getTableData('MemberCardLog');
      expect(logs.length).toBe(1);
      expect(logs[0].chargeId).toBe('charge-001');
      expect(logs[0].remark).toBe('测试消费');
      expect(logs[0].createdAt).toBeDefined();
    });

    it('chargeId 和 remark 默认为 null', () => {
      repo.create(db, {
        cardId: 'card-001',
        type: MemberCardLogType.RECHARGE,
        amount: 10000,
        balanceAfter: 10000,
      });

      const logs = db.getTableData('MemberCardLog');
      expect(logs[0].chargeId).toBeNull();
      expect(logs[0].remark).toBeNull();
    });
  });

  describe('findByCardId', () => {
    beforeEach(() => {
      const logs: Record<string, unknown>[] = [];
      for (let i = 1; i <= 5; i++) {
        logs.push({
          id: `log-${i.toString().padStart(3, '0')}`,
          cardId: 'card-001',
          type: i % 2 === 0 ? 'CONSUME' : 'RECHARGE',
          amount: i * 100,
          balanceAfter: i * 1000,
          clinicId: TEST_CLINIC_ID,
          createdAt: `2024-01-${i.toString().padStart(2, '0')}T00:00:00.000Z`,
        });
      }
      db.seed('MemberCardLog', logs);
    });

    it('按 cardId 查询流水列表', () => {
      const result = repo.findByCardId(db, 'card-001');
      expect(result.length).toBe(5);
    });

    it('按时间倒序排列', () => {
      const result = repo.findByCardId(db, 'card-001');
      expect(result[0].createdAt).toBe('2024-01-05T00:00:00.000Z');
      expect(result[4].createdAt).toBe('2024-01-01T00:00:00.000Z');
    });

    it('分页查询 - 第一页', () => {
      const result = repo.findByCardId(db, 'card-001', { page: 1, pageSize: 2 });
      expect(result.length).toBe(2);
    });

    it('分页查询 - 第二页', () => {
      const result = repo.findByCardId(db, 'card-001', { page: 2, pageSize: 2 });
      expect(result.length).toBe(2);
    });

    it('查询结果包含核心字段', () => {
      const result = repo.findByCardId(db, 'card-001', { page: 1, pageSize: 1 });
      expect(result.length).toBe(1);
      const log = result[0] as unknown as Record<string, unknown>;
      expect(log.id).toBeDefined();
      expect(log.cardId).toBeDefined();
      expect(log.type).toBeDefined();
      expect(log.amount).toBeDefined();
      expect(log.balanceAfter).toBeDefined();
      expect(log.createdAt).toBeDefined();
    });

    it('无记录时返回空数组', () => {
      const result = repo.findByCardId(db, 'non-existent-card');
      expect(result).toEqual([]);
    });
  });
});
