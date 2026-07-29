import { LedgerService } from './ledger.service';
import { MockDbService, asDbService } from '../../db/__mocks__/db-service.mock';
import { DbService } from '../../db/db.service';

describe('LedgerService', () => {
  let db: MockDbService;
  let dbService: DbService;
  let service: LedgerService;

  beforeEach(() => {
    db = new MockDbService();
    // Add checkpoint method to mock
    (db as unknown as Record<string, unknown>).checkpoint = jest.fn();
    dbService = asDbService(db) as unknown as DbService;
    service = new LedgerService(dbService);
  });

  describe('transaction', () => {
    it('应在事务内执行 handler 并返回结果', () => {
      const result = service.transaction((_db) => 42);
      expect(result).toBe(42);
    });

    it('handler 抛异常时应传播异常', () => {
      expect(() => service.transaction(() => {
        throw new Error('test error');
      })).toThrow('test error');
    });

    it('应调用 dbService.transaction', () => {
      const spy = jest.spyOn(db, 'transaction');
      service.transaction(() => 'ok');
      expect(spy).toHaveBeenCalled();
    });
  });

  describe('runWithCheckpoint', () => {
    it('应执行 handler 并调用 checkpoint', () => {
      const checkpointFn = jest.fn();
      (dbService as unknown as Record<string, unknown>).checkpoint = checkpointFn;
      const result = service.runWithCheckpoint((_db) => 'data');
      expect(result).toBe('data');
      expect(checkpointFn).toHaveBeenCalled();
    });

    it('handler 抛异常时不应调用 checkpoint', () => {
      const checkpointFn = jest.fn();
      (dbService as unknown as Record<string, unknown>).checkpoint = checkpointFn;
      expect(() => service.runWithCheckpoint(() => {
        throw new Error('fail');
      })).toThrow('fail');
      expect(checkpointFn).not.toHaveBeenCalled();
    });
  });
});
