import { InventoryConsistencyChecker } from './inventory-consistency-checker';
import { DbService } from '../../../db/db.service';

jest.mock('../../../db/db.service');

describe('InventoryConsistencyChecker', () => {
  let checker: InventoryConsistencyChecker;
  let mockDbService: jest.Mocked<DbService>;

  beforeEach(() => {
    mockDbService = new DbService() as jest.Mocked<DbService>;
    checker = new InventoryConsistencyChecker(mockDbService);
  });

  describe('name', () => {
    it('should return "inventory" as name', () => {
      expect(checker.name).toBe('inventory');
    });
  });

  describe('getChecks', () => {
    it('should return all inventory consistency checks', () => {
      const checks = checker.getChecks();
      expect(checks.length).toBe(3);
      expect(checks.map(c => c.name)).toEqual([
        'inventory_stock_balance',
        'inventory_amount_positive',
        'inventory_transaction_item_exists',
      ]);
    });

    it('should return checks with proper descriptions', () => {
      const checks = checker.getChecks();
      expect(checks[0].description).toBe('库存余额与流水一致性检查');
      expect(checks[1].description).toBe('库存金额正负检查');
      expect(checks[2].description).toBe('库存流水对应库存项存在性检查');
    });

    it('should return checks with proper categories', () => {
      const checks = checker.getChecks();
      expect(checks[0].category).toBe('inventory');
      expect(checks[1].category).toBe('inventory');
      expect(checks[2].category).toBe('inventory');
    });
  });

  describe('checkInventoryStockBalance', () => {
    it('should return ok status when all stock balances match', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const stockBalanceCheck = checks.find(c => c.name === 'inventory_stock_balance')!;
      const result = stockBalanceCheck.fn();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
      expect(result.message).toBe('所有库存项数量与流水记录一致');
    });

    it('should return error status when stock does not match transactions', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          { id: 'inv-001', code: 'INV001', name: '测试物品', stock: 100, calculatedStock: 80 },
        ]),
      } as any);

      const checks = checker.getChecks();
      const stockBalanceCheck = checks.find(c => c.name === 'inventory_stock_balance')!;
      const result = stockBalanceCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].type).toBe('inventory_stock_mismatch');
      expect(result.issues[0].details).toEqual({
        code: 'INV001',
        name: '测试物品',
        stock: 100,
        calculatedStock: 80,
        diff: 20,
      });
    });

    it('should handle items with no transactions', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const stockBalanceCheck = checks.find(c => c.name === 'inventory_stock_balance')!;
      const result = stockBalanceCheck.fn();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
    });

    it('should detect multiple stock mismatches', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          { id: 'inv-001', code: 'INV001', name: '物品1', stock: 100, calculatedStock: 80 },
          { id: 'inv-002', code: 'INV002', name: '物品2', stock: 200, calculatedStock: 250 },
        ]),
      } as any);

      const checks = checker.getChecks();
      const stockBalanceCheck = checks.find(c => c.name === 'inventory_stock_balance')!;
      const result = stockBalanceCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(2);
    });
  });

  describe('checkInventoryAmountPositive', () => {
    it('should return ok status when all amounts are valid', () => {
      mockDbService.prepare
        .mockReturnValueOnce({ all: jest.fn().mockReturnValue([]) } as any)
        .mockReturnValueOnce({ all: jest.fn().mockReturnValue([]) } as any);

      const checks = checker.getChecks();
      const amountPositiveCheck = checks.find(c => c.name === 'inventory_amount_positive')!;
      const result = amountPositiveCheck.fn();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
      expect(result.message).toBe('所有库存项金额均为非负数');
    });

    it('should detect negative stock', () => {
      mockDbService.prepare
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([
            { id: 'inv-001', code: 'INV001', name: '测试物品', stock: -10 },
          ]),
        } as any)
        .mockReturnValueOnce({ all: jest.fn().mockReturnValue([]) } as any);

      const checks = checker.getChecks();
      const amountPositiveCheck = checks.find(c => c.name === 'inventory_amount_positive')!;
      const result = amountPositiveCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].type).toBe('inventory_negative_stock');
    });

    it('should detect negative unit price', () => {
      mockDbService.prepare
        .mockReturnValueOnce({ all: jest.fn().mockReturnValue([]) } as any)
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([
            { id: 'inv-001', code: 'INV001', name: '测试物品', price: -100 },
          ]),
        } as any);

      const checks = checker.getChecks();
      const amountPositiveCheck = checks.find(c => c.name === 'inventory_amount_positive')!;
      const result = amountPositiveCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].type).toBe('inventory_negative_price');
    });

    it('should handle zero stock', () => {
      mockDbService.prepare
        .mockReturnValueOnce({ all: jest.fn().mockReturnValue([]) } as any)
        .mockReturnValueOnce({ all: jest.fn().mockReturnValue([]) } as any);

      const checks = checker.getChecks();
      const amountPositiveCheck = checks.find(c => c.name === 'inventory_amount_positive')!;
      const result = amountPositiveCheck.fn();

      expect(result.status).toBe('ok');
    });

    it('should detect multiple issues', () => {
      mockDbService.prepare
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([
            { id: 'inv-001', code: 'INV001', name: '物品1', stock: -10 },
          ]),
        } as any)
        .mockReturnValueOnce({
          all: jest.fn().mockReturnValue([
            { id: 'inv-002', code: 'INV002', name: '物品2', price: -50 },
          ]),
        } as any);

      const checks = checker.getChecks();
      const amountPositiveCheck = checks.find(c => c.name === 'inventory_amount_positive')!;
      const result = amountPositiveCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(2);
    });
  });

  describe('checkInventoryTransactionItemExists', () => {
    it('should return ok status when all transactions have valid items', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const transactionItemCheck = checks.find(c => c.name === 'inventory_transaction_item_exists')!;
      const result = transactionItemCheck.fn();

      expect(result.status).toBe('ok');
      expect(result.issues.length).toBe(0);
      expect(result.message).toBe('所有库存流水对应的库存项均存在');
    });

    it('should detect orphaned transactions', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          { id: 'tran-001', itemId: 'non-existent-item', type: 'IN', quantity: 10 },
        ]),
      } as any);

      const checks = checker.getChecks();
      const transactionItemCheck = checks.find(c => c.name === 'inventory_transaction_item_exists')!;
      const result = transactionItemCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(1);
      expect(result.issues[0].type).toBe('inventory_transaction_orphan');
    });

    it('should detect multiple orphaned transactions', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([
          { id: 'tran-001', itemId: 'non-existent-item-1', type: 'IN', quantity: 10 },
          { id: 'tran-002', itemId: 'non-existent-item-2', type: 'OUT', quantity: 5 },
        ]),
      } as any);

      const checks = checker.getChecks();
      const transactionItemCheck = checks.find(c => c.name === 'inventory_transaction_item_exists')!;
      const result = transactionItemCheck.fn();

      expect(result.status).toBe('error');
      expect(result.issues.length).toBe(2);
    });
  });

  describe('measureTime', () => {
    it('should measure execution time', () => {
      mockDbService.prepare.mockReturnValue({
        all: jest.fn().mockReturnValue([]),
      } as any);

      const checks = checker.getChecks();
      const stockBalanceCheck = checks.find(c => c.name === 'inventory_stock_balance')!;
      const result = stockBalanceCheck.fn();

      expect(result.durationMs).toBeDefined();
      expect(typeof result.durationMs).toBe('number');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });
  });
});