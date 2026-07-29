import { ChargeConsistencyChecker } from './charge-consistency-checker';
import { DbService } from '../../../db/db.service';

jest.mock('../../../db/db.service');

describe('ChargeConsistencyChecker', () => {
  let checker: ChargeConsistencyChecker;
  let mockDbService: jest.Mocked<DbService>;

  beforeEach(() => {
    mockDbService = new DbService() as jest.Mocked<DbService>;
    checker = new ChargeConsistencyChecker(mockDbService);
  });

  describe('name', () => {
    it('should return "charge" as name', () => {
      expect(checker.name).toBe('charge');
    });
  });

  describe('getChecks', () => {
    it('should return all charge consistency checks', () => {
      const checks = checker.getChecks();
      expect(checks.length).toBe(3);
      expect(checks.map(c => c.name)).toEqual([
        'charge_total_amount',
        'charge_paid_amount',
        'charge_status_payment',
      ]);
    });

    it('should return checks with proper descriptions', () => {
      const checks = checker.getChecks();
      expect(checks[0].description).toBe('收费单总金额与项目金额之和一致性检查');
      expect(checks[1].description).toBe('收费单已付金额与支付记录之和一致性检查');
      expect(checks[2].description).toBe('收费单状态与支付金额匹配检查');
    });

    it('should return checks with proper categories', () => {
      const checks = checker.getChecks();
      expect(checks[0].category).toBe('amount');
      expect(checks[1].category).toBe('amount');
      expect(checks[2].category).toBe('business_rule');
    });
  });

  describe('checkChargeTotalAmount', () => {
    it('should return ok status when all charge totals match', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const totalAmountCheck = checks.find(c => c.name === 'charge_total_amount')!;
      const result = totalAmountCheck.fn();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
      expect(result.message).toBe('所有收费单总金额与项目金额一致');
    });

    it('should return error status when charge total does not match items', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          { id: 'charge-001', number: 'CH001', totalAmount: 100, itemsTotal: 80 },
        ]),
      } as any);

      const checks = checker.getChecks();
      const totalAmountCheck = checks.find(c => c.name === 'charge_total_amount')!;
      const result = totalAmountCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].type).toBe('charge_total_amount_mismatch');
      expect(result.issues[0].details).toEqual({
        chargeNumber: 'CH001',
        totalAmount: 100,
        itemsTotal: 80,
        diff: 20,
      });
    });

    it('should handle charges with no items', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const totalAmountCheck = checks.find(c => c.name === 'charge_total_amount')!;
      const result = totalAmountCheck.fn();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
    });

    it('should detect multiple mismatches', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          { id: 'charge-001', number: 'CH001', totalAmount: 100, itemsTotal: 80 },
          { id: 'charge-002', number: 'CH002', totalAmount: 200, itemsTotal: 150 },
        ]),
      } as any);

      const checks = checker.getChecks();
      const totalAmountCheck = checks.find(c => c.name === 'charge_total_amount')!;
      const result = totalAmountCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(2);
    });
  });

  describe('checkChargePaidAmount', () => {
    it('should return ok status when paid amounts match member card logs', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          { id: 'charge-001', number: 'CH001', paidAmount: 100, cardPayAmount: 100 },
          { id: 'charge-002', number: 'CH002', paidAmount: 0, cardPayAmount: 0 },
        ]),
      } as any);

      const checks = checker.getChecks();
      const paidAmountCheck = checks.find(c => c.name === 'charge_paid_amount')!;
      const result = paidAmountCheck.fn();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
    });

    it('should return error status when paid amount does not match card logs', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          { id: 'charge-001', number: 'CH001', paidAmount: 100, cardPayAmount: 80 },
        ]),
      } as any);

      const checks = checker.getChecks();
      const paidAmountCheck = checks.find(c => c.name === 'charge_paid_amount')!;
      const result = paidAmountCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].type).toBe('charge_paid_amount_mismatch');
    });

    it('should handle charges with no member card logs', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          { id: 'charge-001', number: 'CH001', paidAmount: 0, cardPayAmount: 0 },
        ]),
      } as any);

      const checks = checker.getChecks();
      const paidAmountCheck = checks.find(c => c.name === 'charge_paid_amount')!;
      const result = paidAmountCheck.fn();

      expect(result.status).toBe('ok');
    });

    it('should handle consume and refund types', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          { id: 'charge-001', number: 'CH001', paidAmount: 50, cardPayAmount: 50 },
        ]),
      } as any);

      const checks = checker.getChecks();
      const paidAmountCheck = checks.find(c => c.name === 'charge_paid_amount')!;
      const result = paidAmountCheck.fn();

      expect(result.status).toBe('ok');
    });

    it('should not report issue when paidAmount is 0', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          { id: 'charge-001', number: 'CH001', paidAmount: 0, cardPayAmount: 100 },
        ]),
      } as any);

      const checks = checker.getChecks();
      const paidAmountCheck = checks.find(c => c.name === 'charge_paid_amount')!;
      const result = paidAmountCheck.fn();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
    });
  });

  describe('checkChargeStatusPayment', () => {
    it('should return ok status when status matches payment', () => {
      mockDbService.prepare
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([]),
        } as any)
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([]),
        } as any);

      const checks = checker.getChecks();
      const statusPaymentCheck = checks.find(c => c.name === 'charge_status_payment')!;
      const result = statusPaymentCheck.fn();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
      expect(result.message).toBe('所有收费单状态与支付金额匹配');
    });

    it('should detect PAID status with mismatched amount', () => {
      mockDbService.prepare
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([
            { id: 'charge-001', number: 'CH001', status: 'PAID', totalAmount: 100, paidAmount: 80, refundedAmount: 0 },
          ]),
        } as any)
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([]),
        } as any);

      const checks = checker.getChecks();
      const statusPaymentCheck = checks.find(c => c.name === 'charge_status_payment')!;
      const result = statusPaymentCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].type).toBe('charge_status_paid_mismatch');
    });

    it('should detect full payment without PAID status', () => {
      mockDbService.prepare
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([]),
        } as any)
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([
            { id: 'charge-001', number: 'CH001', status: 'UNPAID', totalAmount: 100, paidAmount: 100, refundedAmount: 0 },
          ]),
        } as any);

      const checks = checker.getChecks();
      const statusPaymentCheck = checks.find(c => c.name === 'charge_status_payment')!;
      const result = statusPaymentCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].type).toBe('charge_full_payment_not_paid_status');
    });

    it('should handle REFUNDED and CANCELLED statuses', () => {
      mockDbService.prepare
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([]),
        } as any)
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([]),
        } as any);

      const checks = checker.getChecks();
      const statusPaymentCheck = checks.find(c => c.name === 'charge_status_payment')!;
      const result = statusPaymentCheck.fn();

      expect(result.status).toBe('ok');
    });

    it('should handle partial payments correctly', () => {
      mockDbService.prepare
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([]),
        } as any)
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([]),
        } as any);

      const checks = checker.getChecks();
      const statusPaymentCheck = checks.find(c => c.name === 'charge_status_payment')!;
      const result = statusPaymentCheck.fn();

      expect(result.status).toBe('ok');
    });

    it('should detect partial payment with full amount received', () => {
      mockDbService.prepare
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([]),
        } as any)
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([
            { id: 'charge-001', number: 'CH001', status: 'PARTIAL', totalAmount: 100, paidAmount: 100, refundedAmount: 0 },
          ]),
        } as any);

      const checks = checker.getChecks();
      const statusPaymentCheck = checks.find(c => c.name === 'charge_status_payment')!;
      const result = statusPaymentCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].type).toBe('charge_full_payment_not_paid_status');
    });
  });

  describe('measureTime', () => {
    it('should measure execution time', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const totalAmountCheck = checks.find(c => c.name === 'charge_total_amount')!;
      const result = totalAmountCheck.fn();

      expect(result.durationMs).toBeDefined();
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});