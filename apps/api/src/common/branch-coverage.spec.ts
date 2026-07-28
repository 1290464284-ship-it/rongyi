/**
 * branch-coverage.spec.ts
 *
 * 针对代码库中剩余约 30% 未覆盖分支的综合测试。
 * 聚焦于：错误处理路径、null/undefined 边界、状态机非法转换、
 *          竞态条件、输入验证边界值。
 *
 * 覆盖模块：
 *   1. AllExceptionsFilter    - 异常格式与未匹配分支
 *   2. SqlInjectionMiddleware - 注入检测的遗漏关键词与深层嵌套
 *   3. RequestTimeoutMiddleware - 超时边界与长耗时路径
 *   4. IdempotencyService     - 过期键、竞态与 FAILED 重试分支
 *   5. ChargeStatusMachine     - 非法转换与金额边界
 *   6. Encryption              - 无效输入与密钥回退分支
 *   7. AlertService           - 告警节流与缓存淘汰分支
 *   8. DbService              - 事务回滚与持久化分支
 */

import { AllExceptionsFilter } from './filters/all-exceptions.filter';
import { HttpException, HttpStatus, ArgumentsHost } from '@nestjs/common';
import {
  BusinessConflictException,
  BusinessValidationException,
} from './errors/business-exception';
import { ErrorCode } from './errors/error-codes';
import { AppLogger } from './services/logger.service';
import { SentryService } from './monitoring/sentry.service';
import { Request, Response } from 'express';

import { SqlInjectionMiddleware } from './middleware/sql-injection.middleware';

import { RequestTimeoutMiddleware } from './middleware/request-timeout.middleware';

import { IdempotencyService } from './services/idempotency.service';
import { IDEMPOTENCY_DEFAULT_TTL_MS } from '../config/constants';
import { createTestDb, createTestDbService, cleanupTestDb } from '../db/test-helpers';
import Database from 'better-sqlite3';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { tmpdir } from 'node:os';

import {
  ChargeStatusMachine,
  InvalidChargeStatusTransitionError,
} from '../modules/financial/charge/domain/charge-status-machine';

import {
  AlertService,
  AlertLevel,
  AlertCategory,
} from './services/alert.service';

// ==================== Helpers ====================

type MockResponse = Response & {
  status: jest.Mock;
  json: jest.Mock;
  _events: Record<string, ((...args: unknown[]) => void)[]>;
};

type MockRequest = Request & {
  traceId?: string;
  method: string;
  url: string;
  destroy: jest.Mock;
};

function createMockRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  return {
    method: 'GET',
    url: '/api/test',
    traceId: 'test-trace-id',
    destroy: jest.fn(),
    ...overrides,
  } as unknown as MockRequest;
}

function createMockResponseFixed(): MockResponse {
  const events: Record<string, ((...args: unknown[]) => void)[]> = {};
  let headersSent = false;
  let res: MockResponse;
  res = {
    statusCode: 200,
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockImplementation((_body: unknown) => {
      headersSent = true;
      return res;
    }),
    end: jest.fn().mockImplementation(() => {
      if ('finish' in events) events['finish'].forEach((fn) => fn());
      return res;
    }),
    on: jest.fn().mockImplementation((event: string, fn: (...args: unknown[]) => void) => {
      if (!Object.hasOwn(events, event)) events[event] = [];
      events[event].push(fn);
    }),
    get headersSent() { return headersSent; },
    _events: events,
  } as unknown as MockResponse;
  return res;
}

function createMockArgumentsHost(req: MockRequest, res: MockResponse): ArgumentsHost {
  return {
    switchToHttp: () => ({
      getRequest: () => req,
      getResponse: () => res,
      getNext: () => ({}),
    }),
    getArgs: () => [],
    getArgByIndex: () => ({}),
    switchToRpc: () => ({ getData: () => ({}), getContext: () => ({}) }),
    switchToWs: () => ({ getClient: () => ({}), getData: () => ({}) }),
    getType: () => 'http',
  } as unknown as ArgumentsHost;
}

function createMockLogger(): AppLogger {
  return {
    logError: jest.fn(),
    log: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  } as unknown as AppLogger;
}

function createMockSentryService(enabled = true): SentryService {
  return {
    isEnabled: jest.fn().mockReturnValue(enabled),
    captureException: jest.fn(),
    captureMessage: jest.fn(),
    init: jest.fn(),
    setTag: jest.fn(),
    withScope: jest.fn(),
  } as unknown as SentryService;
}

// ============================================================
//  1. AllExceptionsFilter — 未覆盖分支
// ============================================================

describe('AllExceptionsFilter — branch coverage', () => {
  let filter: AllExceptionsFilter;
  let logger: AppLogger;
  let sentryService: SentryService;
  let req: MockRequest;
  let res: MockResponse;
  let host: ArgumentsHost;
  let originalNodeEnv: string | undefined;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-01-01T00:00:00.000Z'));

    logger = createMockLogger();
    sentryService = createMockSentryService(true);
    filter = new AllExceptionsFilter(logger, sentryService);
    req = createMockRequest();
    res = createMockResponseFixed();
    host = createMockArgumentsHost(req, res);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    jest.useRealTimers();
  });

  it('HttpException 携带 errorCode 在 body 中时走 httpStatusErrorCodeMap 分支', () => {
    const exception = new HttpException(
      { errorCode: ErrorCode.VALIDATION_ERROR, message: '参数错误' },
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg.errorCode).toBe(ErrorCode.BAD_REQUEST);
    expect(jsonArg.statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(res.status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
  });

  it('HttpException 体中 code 为数字时直接使用', () => {
    const exception = new HttpException(
      { code: ErrorCode.NOT_FOUND, message: '不存在' },
      HttpStatus.NOT_FOUND,
    );

    filter.catch(exception, host);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg.errorCode).toBe(ErrorCode.NOT_FOUND);
    expect(jsonArg.message).toBe('不存在');
  });

  it('HttpException 体中 code 为 legacy 字符串时通过 mapLegacyToErrorCode 映射', () => {
    const exception = new HttpException(
      { code: 'GEN_004', message: '资源不存在' },
      HttpStatus.NOT_FOUND,
    );

    filter.catch(exception, host);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg.errorCode).toBe(ErrorCode.NOT_FOUND);
    expect(jsonArg.message).toBe('资源不存在');
  });

  it('HttpException 无 body code 时走 httpStatusErrorCodeMap 映射', () => {
    const exception = new HttpException(
      'some plain text error',
      HttpStatus.BAD_REQUEST,
    );

    filter.catch(exception, host);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg.errorCode).toBe(ErrorCode.BAD_REQUEST);
    expect(jsonArg.message).toBe('some plain text error');
  });

  it('自定义 HttpException 子类携带 errorCode 属性（hasErrorCode 分支）', () => {
    class CustomHttpException extends HttpException {
      constructor(response: string | Record<string, unknown>, status: number, public errorCode: ErrorCode) {
        super(response, status);
      }
    }

    const exception = new CustomHttpException(
      { message: '自定义错误' },
      HttpStatus.BAD_REQUEST,
      ErrorCode.VALIDATION_ERROR,
    );

    filter.catch(exception, host);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg.errorCode).toBe(ErrorCode.VALIDATION_ERROR);
    expect(jsonArg.message).toBe('自定义错误');
  });

  it('toError 处理循环引用对象（JSON.stringify 失败回退）', () => {
    const circular: any = { name: 'test' };
    circular.self = circular;

    filter.catch(circular, host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg.errorCode).toBe(ErrorCode.UNKNOWN);
  });

  it('toError 处理 symbol 异常', () => {
    filter.catch(Symbol('test-symbol'), host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg.errorCode).toBe(ErrorCode.UNKNOWN);
  });

  it('SQLite 错误没有匹配 handler 时使用通用 DB_ERROR', () => {
    const err = new Error('some completely unknown sqlite error pattern');
    (err as any).code = 'SQLITE_UNKNOWN';

    filter.catch(err, host);

    expect(res.status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg.errorCode).toBe(ErrorCode.DB_ERROR);
  });

  it('BusinessException 带 details 字段正确传递', () => {
    const details = { field: 'email', reason: 'already exists' };
    const exception = new BusinessConflictException(
      '邮箱已被注册',
      ErrorCode.DUPLICATE_ENTRY,
      details,
    );

    filter.catch(exception, host);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg.details).toEqual(details);
  });

  it('响应包含 details 字段（BusinessConflictException）', () => {
    // 使用非敏感字段名（"key" 在 SENSITIVE_FIELDS 中会被脱敏为 ***）
    const details = { reason: '业务冲突示例', count: 1 };
    const exception = new BusinessConflictException(
      '冲突',
      ErrorCode.CONFLICT,
      details,
    );

    filter.catch(exception, host);

    const jsonArg = (res.json as jest.Mock).mock.calls[0][0];
    expect(jsonArg.details).toEqual(details);
  });
});

// ============================================================
//  2. SqlInjectionMiddleware — 未覆盖关键词 / 嵌套分支
// ============================================================

describe('SqlInjectionMiddleware — branch coverage', () => {
  let middleware: SqlInjectionMiddleware;

  beforeEach(() => {
    middleware = new SqlInjectionMiddleware();
  });

  function makeReq(overrides: any = {}) {
    return {
      path: '/api/test',
      method: 'GET',
      ip: '127.0.0.1',
      query: {},
      params: {},
      body: {},
      ...overrides,
    } as any;
  }

  it('检测到 alter table 关键词', () => {
    const req = makeReq({
      path: '/api/patients',
      method: 'GET',
      query: { q: 'alter table users add column age' },
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).toThrow(HttpException);
  });

  it('检测到 create table 关键词', () => {
    const req = makeReq({
      path: '/api/patients',
      method: 'GET',
      query: { q: 'create table users (id int)' },
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).toThrow(HttpException);
  });

  it('检测到 truncate table 关键词', () => {
    const req = makeReq({
      path: '/api/patients',
      method: 'POST',
      body: { name: 'truncate table logs' },
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).toThrow(HttpException);
  });

  it('检测到 union all select 关键词', () => {
    const req = makeReq({
      path: '/api/patients',
      method: 'GET',
      query: { q: '1 union all select 1,2,3' },
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).toThrow(HttpException);
  });

  it('检测到 insert into 关键词', () => {
    const req = makeReq({
      path: '/api/patients',
      method: 'POST',
      body: { data: 'insert into users values (1,2)' },
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).toThrow(HttpException);
  });

  it('深层嵌套对象中的 null 值跳过检测', () => {
    const req = makeReq({
      path: '/api/test',
      method: 'POST',
      body: {
        level1: {
          level2: {
            level3: null,
          },
        },
      },
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).not.toThrow();
    expect(next).toHaveBeenCalled();
  });

  it('嵌套对象中的数字值跳过检测', () => {
    const req = makeReq({
      path: '/api/test',
      method: 'POST',
      body: {
        filter: { page: 1, limit: 10 },
      },
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).not.toThrow();
  });

  it('混合大小写的 drop table 能检测到', () => {
    const req = makeReq({
      path: '/api/test',
      method: 'GET',
      query: { q: 'DrOp TaBlE users' },
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).toThrow(HttpException);
  });

  it('delete from 在 params 数组中能检测到', () => {
    const req = makeReq({
      path: '/api/patients',
      method: 'DELETE',
      params: { ids: ['1', 'delete from users'] },
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).toThrow(HttpException);
  });

  it('数组中嵌套 3 层对象的注入能检测到', () => {
    const req = makeReq({
      path: '/api/test',
      method: 'POST',
      body: [
        { a: { b: { c: 'select from users' } } },
      ],
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).toThrow(HttpException);
  });

  it('SQL 关键词在 body 对象深层嵌套（4 层）仍能检测', () => {
    const req = makeReq({
      path: '/api/test',
      method: 'POST',
      body: { a: { b: { c: { d: 'union select password from users' } } } },
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).toThrow(HttpException);
  });

  it('检测到 xp_ 扩展存储过程', () => {
    const req = makeReq({
      path: '/api/test',
      method: 'GET',
      query: { q: 'xp_cmdshell' },
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).toThrow(HttpException);
  });

  it('检测到 sp_ 扩展存储过程', () => {
    const req = makeReq({
      path: '/api/test',
      method: 'GET',
      query: { q: 'sp_executesql' },
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).toThrow(HttpException);
  });

  it('skip 路径 /api/auth/refresh 放行', () => {
    const req = makeReq({
      path: '/api/auth/refresh',
      method: 'GET',
      query: { token: 'select from users' },
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).not.toThrow();
    expect(next).toHaveBeenCalled();
  });

  it('skip 路径 /api/docs 放行', () => {
    const req = makeReq({
      path: '/api/docs',
      method: 'GET',
      query: { q: 'union select' },
    });
    const next = jest.fn();
    expect(() => middleware.use(req, {} as any, next)).not.toThrow();
    expect(next).toHaveBeenCalled();
  });
});

// ============================================================
//  3. RequestTimeoutMiddleware — 超时边界
// ============================================================

describe('RequestTimeoutMiddleware — branch coverage', () => {
  let middleware: RequestTimeoutMiddleware;

  beforeEach(() => {
    jest.useFakeTimers();
    middleware = new RequestTimeoutMiddleware();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function makeReq(path = '/api/test') {
    return { path, method: 'GET', destroy: jest.fn() } as any;
  }

  function makeRes() {
    const events: Record<string, any[]> = {};
    let headersSent = false;
    let res: any;
    res = {
      statusCode: 200,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockImplementation((_body: any) => {
        headersSent = true;
        return res;
      }),
      end: jest.fn().mockImplementation(() => {
        if ('finish' in events) events['finish'].forEach((fn) => fn());
        return res;
      }),
      on: jest.fn().mockImplementation((event: string, fn: any) => {
        if (!Object.hasOwn(events, event)) events[event] = [];
        events[event].push(fn);
      }),
      get headersSent() { return headersSent; },
      _events: events,
    };
    return res;
  }

  it('刚好 30 秒时触发超时', () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    middleware.use(req, res, next);
    jest.advanceTimersByTime(30000);

    expect(res.status).toHaveBeenCalledWith(408);
  });

  it('29.9 秒时不触发超时', () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    middleware.use(req, res, next);
    jest.advanceTimersByTime(29999);

    expect(res.status).not.toHaveBeenCalledWith(408);
  });

  it('路径包含 /backup 子路径时使用长超时', () => {
    const req = makeReq('/api/backup/full');
    const res = makeRes();
    const next = jest.fn();

    middleware.use(req, res, next);
    jest.advanceTimersByTime(30000);
    expect(res.status).not.toHaveBeenCalledWith(408);

    jest.advanceTimersByTime(90000);
    expect(res.status).toHaveBeenCalledWith(408);
  });

  it('路径包含 /restore 时使用 120 秒超时', () => {
    const req = makeReq('/api/restore/db');
    const res = makeRes();
    const next = jest.fn();

    middleware.use(req, res, next);
    jest.advanceTimersByTime(119999);
    expect(res.status).not.toHaveBeenCalledWith(408);

    jest.advanceTimersByTime(1);
    expect(res.status).toHaveBeenCalledWith(408);
  });

  it('路径包含 /export 时使用长超时', () => {
    const req = makeReq('/api/export/patients');
    const res = makeRes();
    const next = jest.fn();

    middleware.use(req, res, next);
    jest.advanceTimersByTime(120000);
    expect(res.status).toHaveBeenCalledWith(408);
  });

  it('路径包含 /reports 时使用长超时', () => {
    const req = makeReq('/api/reports/monthly');
    const res = makeRes();
    const next = jest.fn();

    middleware.use(req, res, next);
    jest.advanceTimersByTime(30000);
    expect(res.status).not.toHaveBeenCalledWith(408);
  });

  it('超时后 headers 已发送时不再发送响应体（只销毁请求）', () => {
    const req = makeReq();
    const res = makeRes();
    const next = jest.fn();

    middleware.use(req, res, next);
    res.status(200).json({ ok: true });

    jest.advanceTimersByTime(30000);
    expect(req.destroy).toHaveBeenCalled();
  });
});

// ============================================================
//  4. IdempotencyService — 过期 / 竞态 / FAILED 分支
// ============================================================

describe('IdempotencyService — branch coverage', () => {
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
    db.prepare('DELETE FROM IdempotencyRecord').run();
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    cleanupTestDb(db);
  });

  it('FAILED 状态记录应被删除后重新执行', () => {
    const key = 'failed-retry-key';
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_DEFAULT_TTL_MS).toISOString();

    db.prepare(
      "INSERT INTO IdempotencyRecord (id, key, type, status, result, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('failed-id', key, 'test-type', 'FAILED', JSON.stringify({ error: 'previous fail' }), now, expiresAt);

    const handler = jest.fn().mockReturnValue('recovered');
    const result = service.executeInTransaction({ key, type: 'test-type' }, handler);

    expect(result).toBe('recovered');
    expect(handler).toHaveBeenCalledTimes(1);

    const oldRecord = db.prepare('SELECT * FROM IdempotencyRecord WHERE id = ?').get('failed-id');
    expect(oldRecord).toBeUndefined();
  });

  it('COMPLETED 状态但无 result 字段时抛 BusinessValidationException', () => {
    const key = 'completed-no-result';
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_DEFAULT_TTL_MS).toISOString();

    db.prepare(
      "INSERT INTO IdempotencyRecord (id, key, type, status, result, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run('id-no-result', key, 'test-type', 'COMPLETED', null, now, expiresAt);

    const handler = jest.fn().mockReturnValue('fresh-result');
    expect(() =>
      service.executeInTransaction({ key, type: 'test-type' }, handler),
    ).toThrow(BusinessValidationException);
    expect(handler).not.toHaveBeenCalled();
  });

  it('PROCESSING 刚好超过超时边界+1ms 应被清理', () => {
    const key = 'processing-exact-timeout';
    const expiredCreatedAt = new Date(
      Date.now() - PROCESSING_TIMEOUT_MS - 1,
    ).toISOString();
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_DEFAULT_TTL_MS).toISOString();

    db.prepare(
      'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('proc-timeout-id', key, 'test-type', 'PROCESSING', expiredCreatedAt, expiresAt);

    const handler = jest.fn().mockReturnValue('after-timeout-result');
    const result = service.executeInTransaction({ key, type: 'test-type' }, handler);

    expect(handler).toHaveBeenCalledTimes(1);
    expect(result).toBe('after-timeout-result');
  });

  it('PROCESSING 状态差 1ms 未超时应抛出异常', () => {
    const key = 'processing-near-timeout';
    const nearTimeoutCreatedAt = new Date(
      Date.now() - PROCESSING_TIMEOUT_MS + 1,
    ).toISOString();
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_DEFAULT_TTL_MS).toISOString();

    db.prepare(
      'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('proc-near-id', key, 'test-type', 'PROCESSING', nearTimeoutCreatedAt, expiresAt);

    const handler = jest.fn().mockReturnValue('should-not-run');
    expect(() =>
      service.executeInTransaction({ key, type: 'test-type' }, handler),
    ).toThrow(BusinessValidationException);
    expect(handler).not.toHaveBeenCalled();
  });

  it('UNIQUE 冲突时 PROCESSING 已过期(+1ms)应删除并重新执行', () => {
    const key = 'unique-proc-expired';
    const expiredCreatedAt = new Date(Date.now() - PROCESSING_TIMEOUT_MS - 1001).toISOString();
    const pastExpiresAt = new Date(Date.now() - 1).toISOString();

    db.prepare(
      'INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)',
    ).run('expired-proc', key, 'test-type', 'PROCESSING', expiredCreatedAt, pastExpiresAt);

    const originalPrepare = (db as any).prepare.bind(db);
    let insertCallCount = 0;
    jest.spyOn(db as any, 'prepare').mockImplementation((sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes('INSERT INTO IdempotencyRecord') && sql.includes('id, key, type, status, createdAt, expiresAt')) {
        const originalRun = stmt.run.bind(stmt);
        stmt.run = (..._params: unknown[]) => {
          insertCallCount++;
          if (insertCallCount === 1) {
            throw new Error('UNIQUE constraint failed: IdempotencyRecord.key');
          }
          return originalRun(..._params);
        };
      }
      return stmt;
    });

    const handler = jest.fn().mockReturnValue('proc-expired-retry');
    const result = service.executeInTransaction({ key, type: 'test-type' }, handler);

    expect(result).toBe('proc-expired-retry');
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('handler 返回 Promise 时事务回滚，FAILED 记录在事务外持久化', () => {
    const handler = jest.fn().mockReturnValue(Promise.resolve('async'));

    expect(() =>
      service.executeInTransaction({ key: 'promise-key', type: 'test-type' }, handler),
    ).toThrow(/handler 必须为同步函数/);

    const record = db.prepare('SELECT * FROM IdempotencyRecord WHERE key = ?').get('promise-key') as any;
    expect(record).toBeDefined();
    expect(record.status).toBe('FAILED');
  });

  it('handler 返回 Promise.reject 时事务回滚，FAILED 记录在事务外持久化', () => {
    const rejectedPromise = Promise.reject(new Error('async fail'));
    rejectedPromise.catch(() => {});
    const handler = jest.fn().mockReturnValue(rejectedPromise);

    expect(() =>
      service.executeInTransaction({ key: 'promise-reject', type: 'test-type' }, handler),
    ).toThrow(/handler 必须为同步函数/);

    const record = db.prepare('SELECT * FROM IdempotencyRecord WHERE key = ?').get('promise-reject') as any;
    expect(record).toBeDefined();
    expect(record.status).toBe('FAILED');
  });

  it('非 UNIQUE 错误应直接抛出', () => {
    const key = 'other-error-key';
    const originalPrepare = (db as any).prepare.bind(db);
    jest.spyOn(db as any, 'prepare').mockImplementation((sql: string) => {
      const stmt = originalPrepare(sql);
      if (sql.includes('INSERT INTO IdempotencyRecord') && sql.includes('id, key, type, status, createdAt, expiresAt')) {
        stmt.run = jest.fn().mockImplementation(() => {
          throw new Error('Some other database error');
        });
      }
      return stmt;
    });

    const handler = jest.fn();
    expect(() =>
      service.executeInTransaction({ key, type: 'test-type' }, handler),
    ).toThrow('Some other database error');
  });

  it('handler 抛非 Error 对象时事务回滚，FAILED 记录在事务外持久化', () => {
    const handler = jest.fn().mockImplementation(() => { throw 'string error'; });
    expect(() =>
      service.executeInTransaction({ key: 'str-err', type: 'test-type' }, handler),
    ).toThrow('string error');

    const record = db.prepare('SELECT * FROM IdempotencyRecord WHERE key = ?').get('str-err') as any;
    expect(record).toBeDefined();
    expect(record.status).toBe('FAILED');
  });
});

// ============================================================
//  5. ChargeStatusMachine — 非法转换与金额边界
// ============================================================

describe('ChargeStatusMachine — branch coverage', () => {
  describe('非法转换', () => {
    it('REFUNDED 不可转为 PAID', () => {
      expect(() => ChargeStatusMachine.transition('REFUNDED', 'PAID'))
        .toThrow(InvalidChargeStatusTransitionError);
    });

    it('REFUNDED 不可转为 UNPAID', () => {
      expect(() => ChargeStatusMachine.transition('REFUNDED', 'UNPAID'))
        .toThrow(InvalidChargeStatusTransitionError);
    });

    it('REFUNDED 不可转为 PARTIAL', () => {
      expect(() => ChargeStatusMachine.transition('REFUNDED', 'PARTIAL'))
        .toThrow(InvalidChargeStatusTransitionError);
    });

    it('REFUNDED 不可转为 CANCELLED', () => {
      expect(() => ChargeStatusMachine.transition('REFUNDED', 'CANCELLED'))
        .toThrow(InvalidChargeStatusTransitionError);
    });

    it('CANCELLED 不可转为 UNPAID', () => {
      expect(() => ChargeStatusMachine.transition('CANCELLED', 'UNPAID'))
        .toThrow(InvalidChargeStatusTransitionError);
    });

    it('CANCELLED 不可转为 PAID', () => {
      expect(() => ChargeStatusMachine.transition('CANCELLED', 'PAID'))
        .toThrow(InvalidChargeStatusTransitionError);
    });

    it('CANCELLED 不可转为 PARTIAL', () => {
      expect(() => ChargeStatusMachine.transition('CANCELLED', 'PARTIAL'))
        .toThrow(InvalidChargeStatusTransitionError);
    });

    it('UNPAID 不可转为 REFUNDED', () => {
      expect(() => ChargeStatusMachine.transition('UNPAID', 'REFUNDED'))
        .toThrow(InvalidChargeStatusTransitionError);
    });

    it('PARTIAL 不可转为 UNPAID', () => {
      expect(() => ChargeStatusMachine.transition('PARTIAL', 'UNPAID'))
        .toThrow(InvalidChargeStatusTransitionError);
    });
  });

  describe('PAID 允许的特殊转换', () => {
    it('PAID → PARTIAL（部分退款后再收款）', () => {
      expect(ChargeStatusMachine.canTransition('PAID', 'PARTIAL')).toBe(true);
      expect(() => ChargeStatusMachine.transition('PAID', 'PARTIAL')).not.toThrow();
    });

    it('PAID → REFUNDED', () => {
      expect(ChargeStatusMachine.canTransition('PAID', 'REFUNDED')).toBe(true);
      expect(() => ChargeStatusMachine.transition('PAID', 'REFUNDED')).not.toThrow();
    });

    it('PAID → PAID（保持自身）', () => {
      expect(ChargeStatusMachine.canTransition('PAID', 'PAID')).toBe(true);
      expect(() => ChargeStatusMachine.transition('PAID', 'PAID')).not.toThrow();
    });
  });

  describe('resolveByPaymentCents 边界', () => {
    it('paidCents = 0 时返回 UNPAID', () => {
      expect(ChargeStatusMachine.resolveByPaymentCents(0, 10000)).toBe('UNPAID');
    });

    it('paidCents = -1 时返回 UNPAID', () => {
      expect(ChargeStatusMachine.resolveByPaymentCents(-1, 10000)).toBe('UNPAID');
    });

    it('paidCents = totalCents 时返回 PAID', () => {
      expect(ChargeStatusMachine.resolveByPaymentCents(10000, 10000)).toBe('PAID');
    });

    it('paidCents 超过 totalCents 时返回 PAID', () => {
      expect(ChargeStatusMachine.resolveByPaymentCents(15000, 10000)).toBe('PAID');
    });

    it('paidCents = 1 时返回 PARTIAL', () => {
      expect(ChargeStatusMachine.resolveByPaymentCents(1, 10000)).toBe('PARTIAL');
    });

    it('totalCents = 0 且 paidCents = 0 时返回 UNPAID', () => {
      expect(ChargeStatusMachine.resolveByPaymentCents(0, 0)).toBe('UNPAID');
    });
  });

  describe('resolveByRefundCents 边界', () => {
    it('refundedCents = paidCents 时返回 REFUNDED', () => {
      expect(ChargeStatusMachine.resolveByRefundCents(5000, 5000, 'PAID')).toBe('REFUNDED');
    });

    it('refundedCents > paidCents 时返回 REFUNDED', () => {
      expect(ChargeStatusMachine.resolveByRefundCents(5000, 8000, 'PARTIAL')).toBe('REFUNDED');
    });

    it('refundedCents < paidCents 时保持原状态 PAID', () => {
      expect(ChargeStatusMachine.resolveByRefundCents(5000, 2000, 'PAID')).toBe('PAID');
    });

    it('refundedCents < paidCents 时保持原状态 PARTIAL', () => {
      expect(ChargeStatusMachine.resolveByRefundCents(5000, 2000, 'PARTIAL')).toBe('PARTIAL');
    });

    it('refundedCents = 0 时保持原状态', () => {
      expect(ChargeStatusMachine.resolveByRefundCents(5000, 0, 'PAID')).toBe('PAID');
    });
  });

  describe('getAllowedTransitions 边界', () => {
    it('PARTIAL 允许的目标状态', () => {
      const allowed = ChargeStatusMachine.getAllowedTransitions('PARTIAL');
      expect(allowed).toContain('PAID');
      expect(allowed).toContain('PARTIAL');
      expect(allowed).toContain('CANCELLED');
      expect(allowed).not.toContain('UNPAID');
    });

    it('UNKNOWN 状态返回空数组', () => {
      expect(ChargeStatusMachine.getAllowedTransitions('UNKNOWN')).toEqual([]);
    });

    it('空字符串状态返回空数组', () => {
      expect(ChargeStatusMachine.getAllowedTransitions('')).toEqual([]);
    });
  });

  describe('resolveByPayment 元单位版本', () => {
    it('0 元时返回 UNPAID', () => {
      expect(ChargeStatusMachine.resolveByPayment(0, 100)).toBe('UNPAID');
    });

    it('100 元时返回 PAID', () => {
      expect(ChargeStatusMachine.resolveByPayment(100, 100)).toBe('PAID');
    });

    it('0.01 元时返回 PARTIAL', () => {
      expect(ChargeStatusMachine.resolveByPayment(0.01, 100)).toBe('PARTIAL');
    });

    it('负数时返回 UNPAID', () => {
      expect(ChargeStatusMachine.resolveByPayment(-5, 100)).toBe('UNPAID');
    });
  });

  describe('InvalidChargeStatusTransitionError', () => {
    it('错误消息包含 from 和 to 状态', () => {
      const err = new InvalidChargeStatusTransitionError('PAID', 'UNPAID');
      expect(err.message).toContain('PAID');
      expect(err.message).toContain('UNPAID');
      expect(err.name).toBe('InvalidChargeStatusTransitionError');
    });
  });
});

// ============================================================
//  6. Encryption — 无效输入与密钥回退
// ============================================================

describe('Encryption — branch coverage', () => {
  const TEST_KEY_HEX = 'a'.repeat(64);
  let encryptionModule: typeof import('./utils/security/encryption');
  let originalEnv: string | undefined;

  beforeAll(() => {
    originalEnv = process.env.ENCRYPTION_KEY;
    process.env.ENCRYPTION_KEY = TEST_KEY_HEX;
    jest.resetModules();
    encryptionModule = require('./utils/security/encryption');
  });

  afterAll(() => {
    if (originalEnv === undefined) {
      delete process.env.ENCRYPTION_KEY;
    } else {
      process.env.ENCRYPTION_KEY = originalEnv;
    }
  });

  it('decryptFieldWithFlag 对 null 返回 { plaintext: null, needsReencrypt: false }', () => {
    const result = encryptionModule.decryptFieldWithFlag(null);
    expect(result.plaintext).toBeNull();
    expect(result.needsReencrypt).toBe(false);
  });

  it('decryptFieldWithFlag 对 undefined 返回 null', () => {
    const result = encryptionModule.decryptFieldWithFlag(undefined);
    expect(result.plaintext).toBeNull();
    expect(result.needsReencrypt).toBe(false);
  });

  it('加密空字符串应能成功加解密', () => {
    const encrypted = encryptionModule.encryptField('');
    expect(typeof encrypted).toBe('string');
    expect(encrypted.length).toBeGreaterThan(0);
    const decrypted = encryptionModule.decryptField(encrypted);
    expect(decrypted).toBe('');
  });

  it('setLegacyEncryptionKey 接受非 hex 字符串时抛 E_KEY_MISSING', () => {
    expect(() => {
      encryptionModule.setLegacyEncryptionKey('not-a-valid-hex-key');
    }).toThrow(encryptionModule.EncryptionError);
    try {
      encryptionModule.setLegacyEncryptionKey('not-a-valid-hex-key');
    } catch (err: unknown) {
      expect((err as any).code).toBe('E_KEY_MISSING');
    }
  });

  it('encryptField 传入空字符串加解密正常', () => {
    const plaintext = '';
    const encrypted = encryptionModule.encryptField(plaintext);
    const decrypted = encryptionModule.decryptField(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('encryptBuffer 传入显式 key 应能加解密', () => {
    const explicitKey = Buffer.from('c'.repeat(64), 'hex');
    const data = Buffer.from('explicit key test data');
    const encrypted = encryptionModule.encryptBuffer(data, explicitKey);
    expect(encryptionModule.isEncryptedBuffer(encrypted)).toBe(true);
    const decrypted = encryptionModule.decryptBufferIfEncrypted(encrypted, explicitKey);
    expect(decrypted).toEqual(data);
  });

  it('encryptBuffer 使用显式 key 加密后用默认 key 解密应抛 EncryptionError', () => {
    const explicitKey = Buffer.from('d'.repeat(64), 'hex');
    const data = Buffer.from('different key test');
    const encrypted = encryptionModule.encryptBuffer(data, explicitKey);
    expect(() => encryptionModule.decryptBufferIfEncrypted(encrypted)).toThrow(encryptionModule.EncryptionError);
  });

  it('isEncryptedBuffer 对 DBAK 魔数但太短的数据返回 false', () => {
    const shortBuffer = Buffer.from([0x44, 0x42, 0x41, 0x4B]);
    expect(encryptionModule.isEncryptedBuffer(shortBuffer)).toBe(false);
  });

  it('decryptBufferIfEncrypted 对版本号不匹配返回 null', () => {
    const data = Buffer.alloc(40, 0);
    data.write('DBAK', 0);
    data[4] = 99;
    expect(encryptionModule.isEncryptedBuffer(data)).toBe(true);
    expect(encryptionModule.decryptBufferIfEncrypted(data)).toBeNull();
  });

  it('decryptBufferIfEncrypted 对长度不足的数据返回 null', () => {
    const shortData = Buffer.from('DBAK\u{1}short');
    expect(encryptionModule.decryptBufferIfEncrypted(shortData)).toBeNull();
  });

  it('篡改后的密文解密应抛 EncryptionError', () => {
    const original = Buffer.from('tamper test data');
    const encrypted = encryptionModule.encryptBuffer(original);
    encrypted[35] ^= 0xff;
    expect(() => {
      encryptionModule.decryptBufferIfEncrypted(encrypted);
    }).toThrow(encryptionModule.EncryptionError);
  });

  it('getBackupEncryptionKey 返回 Buffer', () => {
    const key = encryptionModule.getBackupEncryptionKey();
    expect(Buffer.isBuffer(key)).toBe(true);
    expect(key.length).toBeGreaterThan(0);
  });
});

// ============================================================
//  7. AlertService — 缓存淘汰 / 边界分支
// ============================================================

describe('AlertService — branch coverage', () => {
  let service: AlertService;
  let mockPrepare: jest.Mock;
  let mockRun: jest.Mock;
  let mockGet: jest.Mock;
  let mockAll: jest.Mock;

  beforeEach(() => {
    mockRun = jest.fn();
    mockGet = jest.fn();
    mockAll = jest.fn();
    mockPrepare = jest.fn().mockReturnValue({
      run: mockRun,
      get: mockGet,
      all: mockAll,
    });

    const mockDbService = { prepare: mockPrepare };
    service = new AlertService(mockDbService as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('缓存超过 MAX_CACHE_ALERTS 后截断到 100 条', () => {
    for (let i = 0; i < 150; i++) {
      service.recordAlert(AlertLevel.INFO, AlertCategory.SYSTEM, `标题${i}`, `消息${i}`);
    }
    const alerts = service.getAlerts();
    expect(alerts.length).toBe(100);
    expect(alerts[0].title).toBe('标题149');
    expect(alerts[99].title).toBe('标题50');
  });

  it('recordFailure 连续 3 次升级为 CRITICAL', () => {
    service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
    service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
    const result = service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
    expect(result.level).toBe(AlertLevel.CRITICAL);
    expect(result.consecutiveFailures).toBe(3);
  });

  it('recordFailure 超过 3 次保持 CRITICAL 并继续计数', () => {
    for (let i = 0; i < 4; i++) {
      service.recordFailure(AlertCategory.DATABASE, 'key1', '标题', '消息');
    }
    const result = service.recordFailure(AlertCategory.DATABASE, 'key1', '标题', '消息');
    expect(result.level).toBe(AlertLevel.CRITICAL);
    expect(result.consecutiveFailures).toBe(5);
  });

  it('recordSuccess 清除失败计数后重新从 1 开始', () => {
    service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
    service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
    service.recordSuccess(AlertCategory.BACKUP, 'key1');
    const result = service.recordFailure(AlertCategory.BACKUP, 'key1', '标题', '消息');
    expect(result.consecutiveFailures).toBe(1);
    expect(result.level).toBe(AlertLevel.ERROR);
  });

  it('resolveAlert 对不存在的 id 返回 false', () => {
    mockRun.mockReturnValue({ changes: 0 });
    const result = service.resolveAlert('nonexistent-id');
    expect(result).toBe(false);
  });

  it('resolveAlert 对已解决告警同步缓存', () => {
    mockRun.mockReturnValue({ changes: 1 });
    const alert = service.recordAlert(AlertLevel.ERROR, AlertCategory.SYSTEM, '标题', '消息');
    const result = service.resolveAlert(alert.id);
    expect(result).toBe(true);
    const cached = service.getAlerts().find((a) => a.id === alert.id);
    expect(cached?.resolved).toBe(true);
    expect(cached?.resolvedAt).toBeDefined();
  });

  it('clearResolved 带 clinicId 过滤', () => {
    mockRun.mockReturnValue({ changes: 3 });
    const result = service.clearResolved('clinic-123');
    expect(result).toBe(3);
    expect(mockPrepare).toHaveBeenCalledWith(
      expect.stringContaining('WHERE resolved = 1 AND clinicId = ?'),
    );
  });

  it('getAlerts 带 offset 时走 DB 查询', () => {
    mockAll.mockReturnValue([]);
    mockGet.mockReturnValue({ count: 0 });
    service.getAlerts({ offset: 10 });
    expect(mockPrepare).toHaveBeenCalled();
  });

  it('getAlerts limit 超过 MAX_CACHE_ALERTS 时走 DB 查询', () => {
    mockAll.mockReturnValue([]);
    mockGet.mockReturnValue({ count: 0 });
    service.getAlerts({ limit: 200 });
    expect(mockPrepare).toHaveBeenCalled();
  });
});

// ============================================================
//  8. DbService — 事务回滚与持久化分支
// ============================================================

describe('DbService — branch coverage', () => {
  describe('事务回滚与持久化', () => {
    let db: Database.Database;
    let dbService: ReturnType<typeof createTestDbService>;

    beforeEach(() => {
      db = createTestDb();
      dbService = createTestDbService(db);
    });

    afterEach(() => {
      cleanupTestDb(db);
    });

    it('事务中 handler 抛异常时回滚', () => {
      db.prepare(
        "INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES ('pre-id', 'pre-key', 'test', 'COMPLETED', ?, ?)",
      ).run(
        new Date().toISOString(),
        new Date(Date.now() + 3600000).toISOString(),
      );

      expect(() => {
        dbService.transaction(() => {
          db.prepare(
            "INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)",
          ).run(
            'new-id', 'new-key', 'test', 'COMPLETED',
            new Date().toISOString(),
            new Date(Date.now() + 3600000).toISOString(),
          );
          throw new Error('transaction rollback test');
        });
      }).toThrow('transaction rollback test');

      const record = db.prepare(
        "SELECT * FROM IdempotencyRecord WHERE key = 'new-key'",
      ).get();
      expect(record).toBeUndefined();
    });

    it('事务正常提交后数据持久化', () => {
      dbService.transaction(() => {
        db.prepare(
          "INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(
          'commit-id', 'commit-key', 'test', 'COMPLETED',
          new Date().toISOString(),
          new Date(Date.now() + 3600000).toISOString(),
        );
      });

      const record = db.prepare(
        "SELECT * FROM IdempotencyRecord WHERE key = 'commit-key'",
      ).get();
      expect(record).toBeDefined();
      expect((record as any).status).toBe('COMPLETED');
    });

    it('openReadonly 返回的只读连接不支持事务', () => {
      const tmpFile = path.join(tmpdir(), `test-ro-${Date.now()}.db`);
      const tmpDb = new Database(tmpFile);
      tmpDb.exec('CREATE TABLE test (id TEXT PRIMARY KEY)');
      tmpDb.close();

      const roConn = dbService.openReadonly(tmpFile);
      expect(() => roConn.transaction(() => 'test')).toThrow(/只读连接不支持事务/);
      roConn.close();
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.unlinkSync(tmpFile);
    });

    it('openReadonly 连接可正常执行只读查询', () => {
      const tmpFile = path.join(tmpdir(), `test-ro2-${Date.now()}.db`);
      const tmpDb = new Database(tmpFile);
      tmpDb.exec('CREATE TABLE test (id TEXT PRIMARY KEY)');
      tmpDb.close();

      const roConn = dbService.openReadonly(tmpFile);
      const result = roConn.exec('SELECT 1');
      expect(result).toBeUndefined();
      roConn.close();
      // eslint-disable-next-line security/detect-non-literal-fs-filename
      fs.unlinkSync(tmpFile);
    });
  });
});