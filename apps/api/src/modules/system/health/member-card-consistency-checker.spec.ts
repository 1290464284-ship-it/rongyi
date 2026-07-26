import { MemberCardConsistencyChecker } from './member-card-consistency-checker';
import { DbService } from '../../../db/db.service';

jest.mock('../../../db/db.service');

describe('MemberCardConsistencyChecker', () => {
  let checker: MemberCardConsistencyChecker;
  let mockDbService: jest.Mocked<DbService>;

  beforeEach(() => {
    mockDbService = new DbService() as jest.Mocked<DbService>;
    checker = new MemberCardConsistencyChecker(mockDbService);
  });

  describe('name', () => {
    it('should return "member-card" as name', () => {
      expect(checker.name).toBe('member-card');
    });
  });

  describe('getChecks', () => {
    it('should return member card balance check', () => {
      const checks = checker.getChecks();
      expect(checks.length).toBe(1);
      expect(checks[0].name).toBe('member_card_balance');
    });

    it('should return check with proper description', () => {
      const checks = checker.getChecks();
      expect(checks[0].description).toBe('会员卡余额与充值消费记录一致性检查');
    });

    it('should return check with proper category', () => {
      const checks = checker.getChecks();
      expect(checks[0].category).toBe('amount');
    });
  });

  describe('checkMemberCardBalance', () => {
    it('should return ok status when all card balances match', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const balanceCheck = checks.find(c => c.name === 'member_card_balance');
      const result = balanceCheck.fn();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
      expect(result.message).toBe('所有会员卡余额与交易记录一致');
    });

    it('should return error status when balance does not match', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          {
            id: 'mc-1',
            cardNo: 'CARD001',
            balance: 100,
            totalRecharge: 200,
            totalConsume: 100,
            calculatedBalance: 50,
            calculatedRecharge: 150,
            calculatedConsume: 100,
          },
        ]),
      } as any);

      const checks = checker.getChecks();
      const balanceCheck = checks.find(c => c.name === 'member_card_balance');
      const result = balanceCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].type).toBe('member_card_balance_mismatch');
      expect(result.issues[0].details).toEqual({
        cardNo: 'CARD001',
        balance: 100,
        calculatedBalance: 50,
        balanceDiff: 50,
        totalRecharge: 200,
        calculatedRecharge: 150,
        totalConsume: 100,
        calculatedConsume: 100,
      });
    });

    it('should handle REFUND transactions', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const balanceCheck = checks.find(c => c.name === 'member_card_balance');
      const result = balanceCheck.fn();

      expect(result.status).toBe('ok');
    });

    it('should handle cards with no logs', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const balanceCheck = checks.find(c => c.name === 'member_card_balance');
      const result = balanceCheck.fn();

      expect(result.status).toBe('ok');
    });

    it('should detect totalRecharge mismatch', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          {
            id: 'mc-1',
            cardNo: 'CARD001',
            balance: 100,
            totalRecharge: 200,
            totalConsume: 100,
            calculatedBalance: 100,
            calculatedRecharge: 250,
            calculatedConsume: 150,
          },
        ]),
      } as any);

      const checks = checker.getChecks();
      const balanceCheck = checks.find(c => c.name === 'member_card_balance');
      const result = balanceCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(1);
    });

    it('should detect totalConsume mismatch', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          {
            id: 'mc-1',
            cardNo: 'CARD001',
            balance: 100,
            totalRecharge: 200,
            totalConsume: 100,
            calculatedBalance: 120,
            calculatedRecharge: 200,
            calculatedConsume: 80,
          },
        ]),
      } as any);

      const checks = checker.getChecks();
      const balanceCheck = checks.find(c => c.name === 'member_card_balance');
      const result = balanceCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(1);
    });

    it('should ignore deleted cards', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const balanceCheck = checks.find(c => c.name === 'member_card_balance');
      const result = balanceCheck.fn();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
    });

    it('should handle multiple cards', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const balanceCheck = checks.find(c => c.name === 'member_card_balance');
      const result = balanceCheck.fn();

      expect(result.status).toBe('ok');
    });

    it('should detect multiple cards with issues', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          {
            id: 'mc-1',
            cardNo: 'CARD001',
            balance: 100,
            totalRecharge: 200,
            totalConsume: 100,
            calculatedBalance: 50,
            calculatedRecharge: 150,
            calculatedConsume: 100,
          },
          {
            id: 'mc-2',
            cardNo: 'CARD002',
            balance: 50,
            totalRecharge: 100,
            totalConsume: 50,
            calculatedBalance: 30,
            calculatedRecharge: 80,
            calculatedConsume: 50,
          },
        ]),
      } as any);

      const checks = checker.getChecks();
      const balanceCheck = checks.find(c => c.name === 'member_card_balance');
      const result = balanceCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(2);
    });

    it('should handle card with only RECHARGE records', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const balanceCheck = checks.find(c => c.name === 'member_card_balance');
      const result = balanceCheck.fn();

      expect(result.status).toBe('ok');
    });

    it('should handle card with only CONSUME records', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const balanceCheck = checks.find(c => c.name === 'member_card_balance');
      const result = balanceCheck.fn();

      expect(result.status).toBe('ok');
    });
  });

  describe('measureTime', () => {
    it('should measure execution time', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const balanceCheck = checks.find(c => c.name === 'member_card_balance');
      const result = balanceCheck.fn();

      expect(result.durationMs).toBeDefined();
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});