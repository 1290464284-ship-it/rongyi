import { MemberPointLogRepository } from './member-point-log.repository';
import { MockDbService } from '../../../../db/__mocks__/db-service.mock';
import { PointLogType } from '../../../../common/constants';
import { TEST_CLINIC_ID } from '../../../../../test/factories';

describe('MemberPointLogRepository', () => {
  let repo: MemberPointLogRepository;
  let db: MockDbService;

  beforeEach(() => {
    repo = new MemberPointLogRepository();
    db = new MockDbService();
  });

  afterEach(() => {
    db.clear();
  });

  describe('create', () => {
    it('创建积分流水记录', () => {
      const now = new Date().toISOString();
      const logId = repo.create(db, {
        cardId: 'card-001',
        type: PointLogType.ADD,
        points: 100,
        balanceAfter: 100,
        clinicId: TEST_CLINIC_ID,
      }, now);

      expect(logId).toBeDefined();
      const logs = db.getTableData('MemberPointLog');
      expect(logs.length).toBe(1);
      expect(logs[0].cardId).toBe('card-001');
      expect(logs[0].type).toBe('ADD');
      expect(logs[0].points).toBe(100);
      expect(logs[0].balanceAfter).toBe(100);
      expect(logs[0].clinicId).toBe(TEST_CLINIC_ID);
      expect(logs[0].createdAt).toBe(now);
    });

    it('创建扣减积分流水', () => {
      repo.create(db, {
        cardId: 'card-001',
        type: PointLogType.DEDUCT,
        points: -50,
        balanceAfter: 50,
        remark: '积分兑换',
        clinicId: TEST_CLINIC_ID,
      });

      const logs = db.getTableData('MemberPointLog');
      expect(logs[0].type).toBe('DEDUCT');
      expect(logs[0].points).toBe(-50);
      expect(logs[0].remark).toBe('积分兑换');
    });

    it('chargeId 和 remark 默认为 null', () => {
      repo.create(db, {
        cardId: 'card-001',
        type: PointLogType.ADD,
        points: 100,
        balanceAfter: 100,
      });

      const logs = db.getTableData('MemberPointLog');
      expect(logs[0].chargeId).toBeNull();
      expect(logs[0].remark).toBeNull();
    });

    it('不传 now 参数时自动生成', () => {
      const before = new Date().toISOString();
      repo.create(db, {
        cardId: 'card-001',
        type: PointLogType.ADD,
        points: 100,
        balanceAfter: 100,
      });
      const after = new Date().toISOString();

      const logs = db.getTableData('MemberPointLog');
      const createdAt = logs[0].createdAt as string;
      expect(createdAt >= before).toBe(true);
      expect(createdAt <= after).toBe(true);
    });
  });

  describe('findByCardId', () => {
    beforeEach(() => {
      const logs: any[] = [];
      for (let i = 1; i <= 5; i++) {
        logs.push({
          id: `pl-${i.toString().padStart(3, '0')}`,
          cardId: 'card-001',
          type: i % 2 === 0 ? 'DEDUCT' : 'ADD',
          points: i * 10,
          balanceAfter: i * 20,
          clinicId: TEST_CLINIC_ID,
          createdAt: `2024-01-${i.toString().padStart(2, '0')}T00:00:00.000Z`,
        });
      }
      db.seed('MemberPointLog', logs);
    });

    it('按 cardId 查询积分流水列表', () => {
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
      expect(log.points).toBeDefined();
      expect(log.balanceAfter).toBeDefined();
      expect(log.createdAt).toBeDefined();
    });

    it('无记录时返回空数组', () => {
      const result = repo.findByCardId(db, 'non-existent-card');
      expect(result).toEqual([]);
    });
  });
});
