import { IdempotencyService } from './idempotency.service';
import { BusinessValidationException } from '@common/errors';

import { IDEMPOTENCY_DEFAULT_TTL_MS } from '../../config/constants';
import { createTestDb, createTestDbService, cleanupTestDb } from '../../db/test-helpers';
import Database from 'better-sqlite3';

describe('IdempotencyService', () => {
  let service: IdempotencyService;
  let db: Database.Database;
  let dbService: ReturnType<typeof createTestDbService>;

  const PROCESSING_TIMEOUT_MS = 120000;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-01T00:00:00.000Z'));

    db = createTestDb();
    dbService = createTestDbService(db);
    service = new IdempotencyService(dbService);

    // 确保每张表干净，避免 UNIQUE 约束冲突
    db.prepare('DELETE FROM IdempotencyRecord').run();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    cleanupTestDb(db);
  });

  describe('executeInTransaction', () => {
    it('首次执行应调用 handler 并返回结果', () => {
      const handler = jest.fn().mockReturnValue({ success: true, data: 'test' });

      const result = service.executeInTransaction(
        { key: 'test-key', type: 'test-type' },
        handler,
      );

      expect(handler).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ success: true, data: 'test' });
    });

    it('首次执行成功后应记录为 COMPLETED 状态', () => {
      const handler = jest.fn().mockReturnValue('result-value');

      service.executeInTransaction(
        { key: 'test-key', type: 'test-type' },
        handler,
      );

      const record = db
        .prepare('SELECT * FROM IdempotencyRecord WHERE key = ?')
        .get('test-key') as any;

      expect(record).toBeDefined();
      expect(record.status).toBe('COMPLETED');
      expect(record.result).toBe(JSON.stringify('result-value'));
      expect(record.type).toBe('test-type');
      expect(record.key).toBe('test-key');
    });

    it('相同 key 的重复请求应返回缓存结果，不调用 handler', () => {
      const handler = jest.fn().mockReturnValue('cached-result');

      const result1 = service.executeInTransaction(
        { key: 'same-key', type: 'test-type' },
        handler,
      );

      const result2 = service.executeInTransaction(
        { key: 'same-key', type: 'test-type' },
        handler,
      );

      expect(handler).toHaveBeenCalledTimes(1);
      expect(result1).toBe('cached-result');
      expect(result2).toBe('cached-result');
    });

    it('不同 key 的请求应独立执行', () => {
      const handler = jest.fn()
        .mockReturnValueOnce('result-1')
        .mockReturnValueOnce('result-2');

      const result1 = service.executeInTransaction(
        { key: 'key-1', type: 'test-type' },
        handler,
      );

      const result2 = service.executeInTransaction(
        { key: 'key-2', type: 'test-type' },
        handler,
      );

      expect(handler).toHaveBeenCalledTimes(2);
      expect(result1).toBe('result-1');
      expect(result2).toBe('result-2');
    });

    it('handler 抛出异常时应原样抛出错误', () => {
      const error = new Error('业务处理失败');
      const handler = jest.fn().mockImplementation(() => {
        throw error;
      });

      expect(() =>
        service.executeInTransaction(
          { key: 'fail-key', type: 'test-type' },
          handler,
        ),
      ).toThrow('业务处理失败');
    });

    it('失败后再次请求应重新执行', () => {
      const handler = jest.fn()
        .mockImplementationOnce(() => {
          throw new Error('第一次失败');
        })
        .mockReturnValueOnce('第二次成功');

      expect(() =>
        service.executeInTransaction(
          { key: 'retry-key', type: 'test-type' },
          handler,
        ),
      ).toThrow('第一次失败');

      const result = service.executeInTransaction(
        { key: 'retry-key', type: 'test-type' },
        handler,
      );

      expect(handler).toHaveBeenCalledTimes(2);
      expect(result).toBe('第二次成功');
    });

    it('PROCESSING 状态未超时应抛出 BusinessValidationException', () => {
      const key = 'processing-key';
      const recordId = 'test-record-id';
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + IDEMPOTENCY_DEFAULT_TTL_MS).toISOString();

      db.prepare(
        'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(recordId, key, 'test-type', 'PROCESSING', now, expiresAt);

      const handler = jest.fn().mockReturnValue('should-not-be-called');

      expect(() =>
        service.executeInTransaction(
          { key, type: 'test-type' },
          handler,
        ),
      ).toThrow(BusinessValidationException);

      expect(handler).not.toHaveBeenCalled();
    });

    it('PROCESSING 状态未超时时应使用默认提示消息', () => {
      const key = 'processing-msg-key';
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + IDEMPOTENCY_DEFAULT_TTL_MS).toISOString();

      db.prepare(
        'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('id-1', key, 'test-type', 'PROCESSING', now, expiresAt);

      const handler = jest.fn();

      expect(() =>
        service.executeInTransaction({ key, type: 'test-type' }, handler),
      ).toThrow('处理中，请稍后再试');
    });

    it('PROCESSING 状态未超时时应使用自定义提示消息', () => {
      const key = 'custom-msg-key';
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + IDEMPOTENCY_DEFAULT_TTL_MS).toISOString();

      db.prepare(
        'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('id-2', key, 'test-type', 'PROCESSING', now, expiresAt);

      const handler = jest.fn();
      const customMessage = '正在处理您的请求，请稍候';

      expect(() =>
        service.executeInTransaction(
          { key, type: 'test-type', processingMessage: customMessage },
          handler,
        ),
      ).toThrow(customMessage);
    });

    it('PROCESSING 状态超时后应清理并重新执行', () => {
      const key = 'timeout-key';
      const expiredCreatedAt = new Date(
        Date.now() - PROCESSING_TIMEOUT_MS - 1000,
      ).toISOString();
      const expiresAt = new Date(Date.now() + IDEMPOTENCY_DEFAULT_TTL_MS).toISOString();

      db.prepare(
        'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('timeout-record', key, 'test-type', 'PROCESSING', expiredCreatedAt, expiresAt);

      const handler = jest.fn().mockReturnValue('after-timeout-result');
      const result = service.executeInTransaction(
        { key, type: 'test-type' },
        handler,
      );

      expect(handler).toHaveBeenCalledTimes(1);
      expect(result).toBe('after-timeout-result');

      const oldRecord = db
        .prepare('SELECT * FROM IdempotencyRecord WHERE id = ?')
        .get('timeout-record');
      expect(oldRecord).toBeUndefined();
    });

    it('应使用自定义 TTL', () => {
      const customTtl = 5000;
      const handler = jest.fn().mockReturnValue('custom-ttl-result');

      service.executeInTransaction(
        { key: 'custom-ttl-key', type: 'test-type', ttlMs: customTtl },
        handler,
      );

      const record = db
        .prepare('SELECT * FROM IdempotencyRecord WHERE key = ?')
        .get('custom-ttl-key') as any;

      const createdAt = new Date(record.createdAt).getTime();
      const expiresAt = new Date(record.expiresAt).getTime();
      expect(expiresAt - createdAt).toBe(customTtl);
    });

    it('未设置 TTL 时应使用默认 TTL', () => {
      const handler = jest.fn().mockReturnValue('default-ttl-result');

      service.executeInTransaction(
        { key: 'default-ttl-key', type: 'test-type' },
        handler,
      );

      const record = db
        .prepare('SELECT * FROM IdempotencyRecord WHERE key = ?')
        .get('default-ttl-key') as any;

      const createdAt = new Date(record.createdAt).getTime();
      const expiresAt = new Date(record.expiresAt).getTime();
      expect(expiresAt - createdAt).toBe(IDEMPOTENCY_DEFAULT_TTL_MS);
    });
  });

  describe('TTL 过期行为', () => {
    it('幂等记录过期后应重新执行', () => {
      const key = 'expire-key';
      const handler = jest.fn()
        .mockReturnValueOnce('first-result')
        .mockReturnValueOnce('second-result');

      service.executeInTransaction(
        { key, type: 'test-type', ttlMs: 10000 },
        handler,
      );
      expect(handler).toHaveBeenCalledTimes(1);

      const expiredTime = new Date(Date.now() - 1000).toISOString();
      db.prepare(
        'UPDATE IdempotencyRecord SET expiresAt = ? WHERE key = ?',
      ).run(expiredTime, key);

      const result = service.executeInTransaction(
        { key, type: 'test-type', ttlMs: 10000 },
        handler,
      );
      expect(result).toBe('second-result');
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('幂等记录未过期时应返回缓存结果', () => {
      const ttlMs = 10000;
      const handler = jest.fn().mockReturnValue('cached-result');

      service.executeInTransaction(
        { key: 'not-expire-key', type: 'test-type', ttlMs },
        handler,
      );
      expect(handler).toHaveBeenCalledTimes(1);

      const futureTime = new Date(Date.now() + 1000).toISOString();
      db.prepare(
        'UPDATE IdempotencyRecord SET expiresAt = ? WHERE key = ?',
      ).run(futureTime, 'not-expire-key');

      const result = service.executeInTransaction(
        { key: 'not-expire-key', type: 'test-type', ttlMs },
        handler,
      );
      expect(result).toBe('cached-result');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('expiresAt 等于当前时间时应视为已过期', () => {
      const key = 'exact-expire-key';
      const handler = jest.fn()
        .mockReturnValueOnce('first')
        .mockReturnValueOnce('second');

      service.executeInTransaction(
        { key, type: 'test-type', ttlMs: 10000 },
        handler,
      );

      const exactTime = new Date().toISOString();
      db.prepare(
        'UPDATE IdempotencyRecord SET expiresAt = ? WHERE key = ?',
      ).run(exactTime, key);

      const result = service.executeInTransaction(
        { key, type: 'test-type', ttlMs: 10000 },
        handler,
      );
      expect(result).toBe('second');
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('jest.advanceTimersByTime 推进时间后过期记录应重新执行', () => {
      const ttlMs = 10000;
      const handler = jest.fn()
        .mockReturnValueOnce('first-result')
        .mockReturnValueOnce('second-result');

      const result1 = service.executeInTransaction(
        { key: 'advance-expire-key', type: 'test-type', ttlMs },
        handler,
      );
      expect(result1).toBe('first-result');
      expect(handler).toHaveBeenCalledTimes(1);

      const recordBefore = db
        .prepare('SELECT expiresAt FROM IdempotencyRecord WHERE key = ?')
        .get('advance-expire-key') as any;

      jest.advanceTimersByTime(ttlMs + 1);

      const nowAfterAdvance = new Date().getTime();
      const expiresAtTime = new Date(recordBefore.expiresAt).getTime();
      expect(nowAfterAdvance).toBeGreaterThan(expiresAtTime);

      const result2 = service.executeInTransaction(
        { key: 'advance-expire-key', type: 'test-type', ttlMs },
        handler,
      );
      expect(result2).toBe('second-result');
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('并发与 UNIQUE 冲突', () => {
    it('UNIQUE 冲突时若已完成应返回缓存结果', () => {
      const key = 'unique-complete-key';
      let callCount = 0;

      const originalTransaction = dbService.transaction.bind(dbService);
      jest.spyOn(dbService, 'transaction').mockImplementation(((fn: (db: any) => unknown) => {
        callCount++;
        if (callCount === 1) {
          const result = originalTransaction(fn);
          db.prepare(
            "UPDATE IdempotencyRecord SET status = 'COMPLETED', result = ? WHERE key = ?",
          ).run(JSON.stringify('concurrent-result'), key);
          return result;
        }
        return originalTransaction(fn);
      }) as any);

      const handler1 = jest.fn().mockReturnValue('first-result');
      service.executeInTransaction({ key, type: 'test-type' }, handler1);

      const handler2 = jest.fn().mockReturnValue('second-result');
      const result = service.executeInTransaction({ key, type: 'test-type' }, handler2);

      expect(result).toBe('concurrent-result');
    });

    it('UNIQUE 冲突时若处理中且未超时应抛出异常', () => {
      const key = 'unique-processing-key';
      let insertCount = 0;

      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + IDEMPOTENCY_DEFAULT_TTL_MS).toISOString();
      db.prepare(
        'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('existing-id', key, 'test-type', 'PROCESSING', now, expiresAt);

      const originalPrepare = (db as any).prepare.bind(db);
      jest.spyOn(db as any, 'prepare').mockImplementation(((sql: string) => {
        const stmt = originalPrepare(sql);
        if (sql.includes('INSERT INTO IdempotencyRecord')) {
          const originalRun = stmt.run.bind(stmt);
          stmt.run = (...params: unknown[]) => {
            insertCount++;
            if (insertCount === 1) {
              throw new Error('UNIQUE constraint failed: IdempotencyRecord.key');
            }
            return originalRun(...params);
          };
        }
        return stmt;
      }) as any);

      const handler = jest.fn().mockReturnValue('should-not-run');

      expect(() =>
        service.executeInTransaction({ key, type: 'test-type' }, handler),
      ).toThrow(BusinessValidationException);
      expect(handler).not.toHaveBeenCalled();
    });

    it('UNIQUE 冲突时若已完成应返回结果', () => {
      const key = 'unique-completed-key';
      let insertCount = 0;

      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + IDEMPOTENCY_DEFAULT_TTL_MS).toISOString();
      db.prepare(
        'INSERT INTO IdempotencyRecord (id, key, type, status, result, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run('completed-id', key, 'test-type', 'COMPLETED', JSON.stringify('pre-existing-result'), now, expiresAt);

      const originalPrepare = (db as any).prepare.bind(db);
      jest.spyOn(db as any, 'prepare').mockImplementation(((sql: string) => {
        const stmt = originalPrepare(sql);
        if (sql.includes('INSERT INTO IdempotencyRecord')) {
          const originalRun = stmt.run.bind(stmt);
          stmt.run = (...params: unknown[]) => {
            insertCount++;
            if (insertCount === 1) {
              throw new Error('UNIQUE constraint failed: IdempotencyRecord.key');
            }
            return originalRun(...params);
          };
        }
        return stmt;
      }) as any);

      const handler = jest.fn().mockReturnValue('should-not-run');
      const result = service.executeInTransaction(
        { key, type: 'test-type' },
        handler,
      );

      expect(result).toBe('pre-existing-result');
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('并发与 UNIQUE 冲突 - 更多场景', () => {
    it('UNIQUE 冲突时若记录已过期应删除并重新执行', () => {
      const key = 'unique-expired-key';
      let insertCount = 0;

      const now = new Date().toISOString();
      const expiredTime = new Date(Date.now() - 1000).toISOString();
      db.prepare(
        'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('expired-id', key, 'test-type', 'COMPLETED', now, expiredTime);

      const originalPrepare = (db as any).prepare.bind(db);
      jest.spyOn(db as any, 'prepare').mockImplementation(((sql: string) => {
        const stmt = originalPrepare(sql);
        if (sql.includes('INSERT INTO IdempotencyRecord') && sql.includes('id, key, type, status, createdAt, expiresAt')) {
          const originalRun = stmt.run.bind(stmt);
          stmt.run = (...params: unknown[]) => {
            insertCount++;
            if (insertCount === 1) {
              throw new Error('UNIQUE constraint failed: IdempotencyRecord.key');
            }
            return originalRun(...params);
          };
        }
        return stmt;
      }) as any);

      const handler = jest.fn().mockReturnValue('retry-success');
      const result = service.executeInTransaction({ key, type: 'test-type' }, handler);

      expect(result).toBe('retry-success');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('UNIQUE 冲突时若 PROCESSING 超时应删除并重新执行', () => {
      const key = 'unique-processing-timeout-key';
      let insertCount = 0;

      const expiredCreatedAt = new Date(Date.now() - PROCESSING_TIMEOUT_MS - 1000).toISOString();
      const expiresAt = new Date(Date.now() + IDEMPOTENCY_DEFAULT_TTL_MS).toISOString();

      const originalPrepare = (db as any).prepare.bind(db);
      jest.spyOn(db as any, 'prepare').mockImplementation(((sql: string) => {
        const stmt = originalPrepare(sql);

        if (sql.startsWith('SELECT * FROM IdempotencyRecord WHERE key = ?') && sql.includes('expiresAt > ?')) {
          stmt.get = jest.fn().mockReturnValue(undefined);
          return stmt;
        }

        if (sql.includes('INSERT INTO IdempotencyRecord') && sql.includes('id, key, type, status, createdAt, expiresAt')) {
          const originalRun = stmt.run.bind(stmt);
          stmt.run = (...params: unknown[]) => {
            insertCount++;
            if (insertCount === 1) {
              db.prepare(
                'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
              ).run('timeout-proc-id', key, 'test-type', 'PROCESSING', expiredCreatedAt, expiresAt);
              throw new Error('UNIQUE constraint failed: IdempotencyRecord.key');
            }
            return originalRun(...params);
          };
        }
        return stmt;
      }) as any);

      const handler = jest.fn().mockReturnValue('processing-timeout-result');
      const result = service.executeInTransaction({ key, type: 'test-type' }, handler);

      expect(result).toBe('processing-timeout-result');
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('非 UNIQUE 错误应直接抛出', () => {
      const key = 'other-error-key';

      const originalPrepare = (db as any).prepare.bind(db);
      jest.spyOn(db as any, 'prepare').mockImplementation(((sql: string) => {
        const stmt = originalPrepare(sql);
        if (sql.includes('INSERT INTO IdempotencyRecord') && sql.includes('id, key, type, status, createdAt, expiresAt')) {
          stmt.run = jest.fn().mockImplementation(() => {
            throw new Error('Some other database error');
          });
        }
        return stmt;
      }) as any);

      const handler = jest.fn();

      expect(() =>
        service.executeInTransaction({ key, type: 'test-type' }, handler),
      ).toThrow('Some other database error');
    });
  });

  describe('失败状态记录', () => {
    it('handler 失败后应在事务外持久化 FAILED 状态', () => {
      const key = 'failed-status-key';
      const errorMessage = '测试失败消息';

      const handler = jest.fn().mockImplementation(() => {
        throw new Error(errorMessage);
      });

      expect(() =>
        service.executeInTransaction({ key, type: 'test-type' }, handler),
      ).toThrow(errorMessage);

      // P2 修复后 FAILED 在事务外写入，记录应持久化
      const record = db
        .prepare('SELECT * FROM IdempotencyRecord WHERE key = ?')
        .get(key) as any;
      expect(record).toBeDefined();
      expect(record.status).toBe('FAILED');
      expect(record.result).toBeDefined();
      const result = JSON.parse(record.result);
      expect(result.error).toBe(errorMessage);
    });
  });

  describe('返回值类型', () => {
    it('应正确返回对象类型结果', () => {
      const obj = { name: 'test', value: 42, nested: { a: 1 } };
      const handler = jest.fn().mockReturnValue(obj);

      const result = service.executeInTransaction(
        { key: 'obj-key', type: 'test-type' },
        handler,
      );

      expect(result).toEqual(obj);
      expect(typeof result).toBe('object');
    });

    it('应正确返回数组类型结果', () => {
      const arr = [1, 2, 3, { id: 'a' }];
      const handler = jest.fn().mockReturnValue(arr);

      const result = service.executeInTransaction(
        { key: 'arr-key', type: 'test-type' },
        handler,
      );

      expect(result).toEqual(arr);
      expect(Array.isArray(result)).toBe(true);
    });

    it('应正确返回数字类型结果', () => {
      const handler = jest.fn().mockReturnValue(123);

      const result = service.executeInTransaction(
        { key: 'num-key', type: 'test-type' },
        handler,
      );

      expect(result).toBe(123);
      expect(typeof result).toBe('number');
    });

    it('应正确返回字符串类型结果', () => {
      const handler = jest.fn().mockReturnValue('hello');

      const result = service.executeInTransaction(
        { key: 'str-key', type: 'test-type' },
        handler,
      );

      expect(result).toBe('hello');
      expect(typeof result).toBe('string');
    });

    it('应正确返回 null 值', () => {
      const handler = jest.fn().mockReturnValue(null);

      const result = service.executeInTransaction(
        { key: 'null-key', type: 'test-type' },
        handler,
      );

      expect(result).toBeNull();
    });

    it('应正确返回布尔值 true', () => {
      const handler = jest.fn().mockReturnValue(true);

      const result = service.executeInTransaction(
        { key: 'bool-key', type: 'test-type' },
        handler,
      );

      expect(result).toBe(true);
      expect(typeof result).toBe('boolean');
    });

    it('应正确返回布尔值 false', () => {
      const handler = jest.fn().mockReturnValue(false);

      const result = service.executeInTransaction(
        { key: 'bool-false-key', type: 'test-type' },
        handler,
      );

      expect(result).toBe(false);
    });

    it('应正确返回 0 （falsy 数字）', () => {
      const handler = jest.fn().mockReturnValue(0);

      const result = service.executeInTransaction(
        { key: 'zero-key', type: 'test-type' },
        handler,
      );

      expect(result).toBe(0);
    });

    it('应正确返回空字符串', () => {
      const handler = jest.fn().mockReturnValue('');

      const result = service.executeInTransaction(
        { key: 'empty-str-key', type: 'test-type' },
        handler,
      );

      expect(result).toBe('');
    });
  });

  describe('Promise 返回检测', () => {
    it('handler 返回 Promise 时事务回滚，FAILED 记录在事务外持久化', () => {
      const handler = jest.fn().mockReturnValue(Promise.resolve('async-result'));

      expect(() =>
        service.executeInTransaction(
          { key: 'promise-key', type: 'test-type' },
          handler,
        ),
      ).toThrow(/handler 必须为同步函数/);

      const record = db
        .prepare('SELECT * FROM IdempotencyRecord WHERE key = ?')
        .get('promise-key') as any;
      expect(record).toBeDefined();
      expect(record.status).toBe('FAILED');
    });

    it('handler 返回 Promise.reject 时事务回滚，FAILED 记录在事务外持久化', () => {
      const rejectedPromise = Promise.reject(new Error('async fail'));
      rejectedPromise.catch(() => {});
      const handler = jest.fn().mockReturnValue(rejectedPromise);

      expect(() =>
        service.executeInTransaction(
          { key: 'promise-reject-key', type: 'test-type' },
          handler,
        ),
      ).toThrow(/handler 必须为同步函数/);

      const record = db
        .prepare('SELECT * FROM IdempotencyRecord WHERE key = ?')
        .get('promise-reject-key') as any;
      expect(record).toBeDefined();
      expect(record.status).toBe('FAILED');
    });

    it('Promise 检测后再次请求应重新执行', () => {
      const handler = jest.fn()
        .mockReturnValueOnce(Promise.resolve('async-result'))
        .mockReturnValueOnce('sync-success');

      expect(() =>
        service.executeInTransaction(
          { key: 'promise-retry-key', type: 'test-type' },
          handler,
        ),
      ).toThrow(/handler 必须为同步函数/);

      const result = service.executeInTransaction(
        { key: 'promise-retry-key', type: 'test-type' },
        handler,
      );

      expect(result).toBe('sync-success');
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  describe('FAILED 状态重试', () => {
    it('FAILED 状态记录应被删除后重新执行', () => {
      const key = 'failed-retry-key';
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + IDEMPOTENCY_DEFAULT_TTL_MS).toISOString();

      db.prepare(
        "INSERT INTO IdempotencyRecord (id, key, type, status, result, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run('failed-id', key, 'test-type', 'FAILED', JSON.stringify({ error: 'previous fail' }), now, expiresAt);

      const handler = jest.fn().mockReturnValue('recovered');
      const result = service.executeInTransaction(
        { key, type: 'test-type' },
        handler,
      );

      expect(result).toBe('recovered');
      expect(handler).toHaveBeenCalledTimes(1);

      const oldRecord = db
        .prepare('SELECT * FROM IdempotencyRecord WHERE id = ?')
        .get('failed-id');
      expect(oldRecord).toBeUndefined();
    });
  });

  describe('边界条件与错误处理', () => {
    it('handler 返回 undefined 应正常处理', () => {
      const handler = jest.fn().mockReturnValue(undefined);

      const result = service.executeInTransaction(
        { key: 'undefined-key', type: 'test-type' },
        handler,
      );

      expect(result).toBeUndefined();
    });

    it('handler 抛出非 Error 对象时事务回滚，FAILED 记录在事务外持久化', () => {
      const handler = jest.fn().mockImplementation(() => {
        throw 'string error';
      });

      expect(() =>
        service.executeInTransaction(
          { key: 'string-err-key', type: 'test-type' },
          handler,
        ),
      ).toThrow('string error');

      const record = db
        .prepare('SELECT * FROM IdempotencyRecord WHERE key = ?')
        .get('string-err-key') as any;
      expect(record).toBeDefined();
      expect(record.status).toBe('FAILED');
    });

    it('handler 抛出数字应正常捕获', () => {
      const handler = jest.fn().mockImplementation(() => {
        throw 42;
      });

      expect(() =>
        service.executeInTransaction(
          { key: 'num-err-key', type: 'test-type' },
          handler,
        ),
      ).toThrow('42');
    });

    it('COMPLETED 状态但无 result 字段时应抛出 BusinessValidationException', () => {
      const key = 'completed-no-result-key';
      const now = new Date().toISOString();
      const expiresAt = new Date(Date.now() + IDEMPOTENCY_DEFAULT_TTL_MS).toISOString();

      db.prepare(
        "INSERT INTO IdempotencyRecord (id, key, type, status, result, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run('id-no-result', key, 'test-type', 'COMPLETED', null, now, expiresAt);

      const handler = jest.fn().mockReturnValue('fresh-result');
      expect(() =>
        service.executeInTransaction(
          { key, type: 'test-type' },
          handler,
        ),
      ).toThrow(BusinessValidationException);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('幂等键隔离', () => {
    it('相同 key 不同 type 应共享缓存', () => {
      const handler = jest.fn().mockReturnValue('shared-result');

      const result1 = service.executeInTransaction(
        { key: 'shared-key', type: 'type-a' },
        handler,
      );

      const result2 = service.executeInTransaction(
        { key: 'shared-key', type: 'type-b' },
        handler,
      );

      expect(result1).toBe('shared-result');
      expect(result2).toBe('shared-result');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('UNIQUE 冲突 - 过期记录清理', () => {
    it('UNIQUE 冲突时若记录已过期应删除并重新执行', () => {
      const key = 'unique-expired-key-2';
      let insertCount = 0;

      const expiredTime = new Date(Date.now() - 1000).toISOString();
      const now = new Date().toISOString();
      const _expiresAt = new Date(Date.now() + IDEMPOTENCY_DEFAULT_TTL_MS).toISOString();

      db.prepare(
        "INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)",
      ).run('expired-completed-id', key, 'test-type', 'COMPLETED', now, expiredTime);

      const originalPrepare = (db as any).prepare.bind(db);
      jest.spyOn(db as any, 'prepare').mockImplementation(((sql: string) => {
        const stmt = originalPrepare(sql);
        if (sql.includes('INSERT INTO IdempotencyRecord') && sql.includes('id, key, type, status, createdAt, expiresAt')) {
          const originalRun = stmt.run.bind(stmt);
          stmt.run = (...params: unknown[]) => {
            insertCount++;
            if (insertCount === 1) {
              throw new Error('UNIQUE constraint failed: IdempotencyRecord.key');
            }
            return originalRun(...params);
          };
        }
        return stmt;
      }) as any);

      const handler = jest.fn().mockReturnValue('expired-retry-success');
      const result = service.executeInTransaction({ key, type: 'test-type' }, handler);

      expect(result).toBe('expired-retry-success');
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
