import { RefundRepository } from './refund.repository';

function buildMockDb(overrides: { getReturn?: unknown; allReturn?: unknown[] } = {}) {
  const { getReturn = null, allReturn = [] } = overrides;
  const calls: Array<{ sql: string; method: string; params: unknown[] }> = [];
  return {
    _calls: calls,
    prepare(sql: string) {
      return {
        get: (...params: unknown[]) => { calls.push({ sql, method: 'get', params }); return getReturn; },
        all: (...params: unknown[]) => { calls.push({ sql, method: 'all', params }); return allReturn; },
        run: (...params: unknown[]) => { calls.push({ sql, method: 'run', params }); return { changes: 1, lastInsertRowid: 1 }; },
      };
    },
  };
}

describe('RefundRepository', () => {
  let repo: RefundRepository;

  beforeEach(() => {
    repo = new RefundRepository();
  });

  describe('create', () => {
    it('应插入退款记录', () => {
      const db = buildMockDb();
      repo.create(db, { id: 'r-1', chargeId: 'c-1', patientId: 'p-1', amount: 500, createdAt: '2026-07-30' });
      expect(db._calls[0].sql).toContain('INSERT INTO Refund');
      expect(db._calls[0].params).toContain('r-1');
      expect(db._calls[0].params).toContain(500);
    });
  });

  describe('update', () => {
    it('updates 为空时应直接返回不执行 SQL', () => {
      const db = buildMockDb();
      repo.update(db, 'r-1', [], [], ' AND clinicId = ?', ['cl-1']);
      expect(db._calls).toHaveLength(0);
    });

    it('应构造 UPDATE 语句', () => {
      const db = buildMockDb();
      repo.update(db, 'r-1', ['amount = ?', 'updatedAt = ?'], [600, '2026-07-30'], ' AND clinicId = ?', ['cl-1']);
      expect(db._calls[0].sql).toContain('UPDATE Refund SET amount = ?, updatedAt = ? WHERE id = ? AND clinicId = ?');
      expect(db._calls[0].params).toEqual([600, '2026-07-30', 'r-1', 'cl-1']);
    });
  });

  describe('findById', () => {
    it('应查询单条退款记录', () => {
      const db = buildMockDb({ getReturn: { id: 'r-1', amount: 500 } });
      const result = repo.findById(db, 'r-1', ' AND clinicId = ?', ['cl-1']);
      expect(db._calls[0].sql).toContain('SELECT');
      expect(db._calls[0].sql).toContain('FROM Refund');
      expect(db._calls[0].params[0]).toBe('r-1');
      expect(result).toEqual({ id: 'r-1', amount: 500 });
    });
  });

  describe('findMany', () => {
    it('应按条件分页查询退款列表', () => {
      const db = buildMockDb({ getReturn: { total: 5 }, allReturn: [{ id: 'r-1' }] });
      const result = repo.findMany(db, {
        clinicClause: 'clinicId = ?',
        clinicParams: ['cl-1'],
        page: 1,
        pageSize: 20,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });
      expect(result.items).toEqual([{ id: 'r-1' }]);
      expect(result.total).toBe(5);
    });

    it('应支持按 patientId 过滤', () => {
      const db = buildMockDb({ getReturn: { total: 1 }, allReturn: [{ id: 'r-1' }] });
      repo.findMany(db, {
        clinicClause: '',
        clinicParams: [],
        patientId: 'p-1',
        page: 1,
        pageSize: 10,
        sortBy: 'createdAt',
        sortOrder: 'DESC',
      });
      const countCall = db._calls.find(c => c.sql.includes('COUNT'));
      expect(countCall?.sql).toContain('patientId = ?');
      expect(countCall?.params).toContain('p-1');
    });

    it('应支持按 chargeId 过滤', () => {
      const db = buildMockDb({ getReturn: { total: 0 }, allReturn: [] });
      repo.findMany(db, {
        clinicClause: 'AND clinicId = ?',
        clinicParams: ['cl-1'],
        chargeId: 'c-1',
        page: 2,
        pageSize: 10,
        sortBy: 'createdAt',
        sortOrder: 'ASC',
      });
      const countCall = db._calls.find(c => c.sql.includes('COUNT'));
      expect(countCall?.sql).toContain('chargeId = ?');
    });
  });

  describe('findChargeForRefund', () => {
    it('应查询 Charge 表用于退款校验', () => {
      const db = buildMockDb({ getReturn: { id: 'c-1', patientId: 'p-1', totalAmount: 1000, paidAmount: 1000, refundedAmount: 0, status: 'PAID' } });
      const result = repo.findChargeForRefund(db, 'c-1', ' AND clinicId = ?', ['cl-1']);
      expect(db._calls[0].sql).toContain('FROM Charge');
      expect(result?.status).toBe('PAID');
    });
  });

  describe('updateChargeRefund', () => {
    it('应使用 CAS 乐观锁更新退款金额', () => {
      const db = buildMockDb();
      repo.updateChargeRefund(db, 'c-1', 500, 'PARTIAL_REFUND', '2026-07-30', 500, ' AND clinicId = ?', ['cl-1'], 0);
      expect(db._calls[0].sql).toContain('refundedAmount = ?');
      expect(db._calls[0].sql).toContain('refundedAmount = ? AND refundedAmount + ? <= paidAmount');
    });
  });

  describe('findMemberCardConsumeSum', () => {
    it('应查询会员卡消费汇总', () => {
      const db = buildMockDb({ getReturn: { cardId: 'mc-1', totalConsumed: 2000 } });
      const result = repo.findMemberCardConsumeSum(db, 'c-1', 'CONSUME', '', []);
      expect(db._calls[0].sql).toContain('MemberCardLog');
      expect(result?.totalConsumed).toBe(2000);
    });
  });

  describe('findMemberCardRefundSum', () => {
    it('应查询会员卡退款汇总', () => {
      const db = buildMockDb({ getReturn: { totalRefunded: 500 } });
      const result = repo.findMemberCardRefundSum(db, 'c-1', 'REFUND', '', []);
      expect(result?.totalRefunded).toBe(500);
    });
  });

  describe('updateMemberCardBalance', () => {
    it('应使用乐观锁更新会员卡余额', () => {
      const db = buildMockDb();
      repo.updateMemberCardBalance(db, 'mc-1', 500, '2026-07-30', 'c-1', '', [], );
      expect(db._calls[0].sql).toContain('UPDATE MemberCard SET balance = balance + ?');
    });
  });

  describe('createMemberCardLog', () => {
    it('应插入 REFUND 类型的会员卡日志', () => {
      const db = buildMockDb();
      repo.createMemberCardLog(db, { id: 'log-1', cardId: 'mc-1', amount: 500, balanceAfter: 1500, chargeId: 'c-1', createdAt: '2026-07-30' });
      expect(db._calls[0].sql).toContain('INSERT INTO MemberCardLog');
      expect(db._calls[0].params).toContain('REFUND');
    });
  });

  describe('findDebtByCharge', () => {
    it('应查询赊账记录', () => {
      const db = buildMockDb({ getReturn: { id: 'd-1', totalAmount: 1000, paidAmount: 500, debtAmount: 500, status: 'PARTIAL' } });
      const result = repo.findDebtByCharge(db, 'c-1', '', []);
      expect(db._calls[0].sql).toContain('DebtRecord');
      expect(result?.status).toBe('PARTIAL');
    });
  });

  describe('updateDebt', () => {
    it('应使用乐观锁更新赊账记录', () => {
      const db = buildMockDb();
      repo.updateDebt(db, 'd-1', { paidAmount: 800, debtAmount: 200, status: 'PARTIAL', updatedAt: '2026-07-30', oldPaidAmount: 500, oldDebtAmount: 500 }, '', []);
      expect(db._calls[0].sql).toContain('UPDATE DebtRecord');
      expect(db._calls[0].sql).toContain('paidAmount = ? AND debtAmount = ?');
    });
  });
});
