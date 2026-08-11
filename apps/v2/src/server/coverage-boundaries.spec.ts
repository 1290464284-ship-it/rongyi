import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NextFunction, Request, Response } from 'express';
import DatabaseClass from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { SystemClock } from './infrastructure/clock';
import { deepHealth } from './http/health';
import { metricsMiddleware, metricsSnapshot, persistMetrics } from './http/metrics';
import { authMiddleware, errorMiddleware, roleMiddleware, traceMiddleware } from './http/middleware';
import { createRateLimit } from './http/rate-limit';
import { validatePayload } from './http/validation';
import { Logger } from './infrastructure/logger';
import { importLegacyDatabase } from './infrastructure/legacy-import';
import { withIdempotency } from './infrastructure/idempotency';
import { AppError } from './infrastructure/errors';
import type { AuthService } from './application/services';
import type { ResourceDefinition, ResourceField } from '../domain/contracts';

describe('coverage boundaries', () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-boundary-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('covers the system clock date and now paths', () => {
    const clock = new SystemClock();
    const now = clock.now();
    expect(now).toBeInstanceOf(Date);
    const date = new Date('2026-08-03T16:00:00.000Z');
    expect(clock.clinicDate(date)).toBe('2026-08-04');
    expect(clock.clinicDate(date.toISOString())).toBe('2026-08-04');
    expect(clock.clinicDate(date.getTime())).toBe('2026-08-04');
    expect(clock.clinicDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('covers deep health success and failure paths', () => {
    const db = { pragma: () => [{ integrity_check: 'ok' }] } as unknown as Database.Database;
    expect(deepHealth(db, dataDir)).toMatchObject({ database: 'ok', backupDirectory: 'ok' });

    const corruptDb = { pragma: () => [{ integrity_check: 'corrupt' }] } as unknown as Database.Database;
    const blockedFile = path.join(dataDir, 'blocked-file');
    fs.writeFileSync(blockedFile, 'not a directory');
    const blockedDir = path.join(blockedFile, 'child');
    const result = deepHealth(corruptDb, blockedDir);
    expect(result.database).toBe('corrupt');
    expect(result.backupDirectory).toBe('not-writable');
    expect(result.diskFreeBytes).toBe(0);
  });

  it('covers metrics middleware, snapshot, and persistence failures', () => {
    let finish: () => void = () => {};
    const res = {
      statusCode: 500,
      route: undefined,
      on: (_event: string, callback: () => void) => {
        finish = callback;
      },
    } as unknown as Response;
    const req = { method: 'GET', path: '/no-route' } as unknown as Request;
    const next: NextFunction = vi.fn();
    metricsMiddleware(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    finish();
    expect(metricsSnapshot()).toEqual(expect.any(Array));

    const routeReq = { method: 'POST', route: { path: '/api/v2/test' }, path: '/fallback' } as unknown as Request;
    metricsMiddleware(routeReq, res, next);
    finish();

    for (let i = 0; i < 1001; i += 1) {
      let overflowFinish: () => void = () => {};
      const overflowRes = {
        statusCode: 200,
        route: undefined,
        on: (_event: string, callback: () => void) => {
          overflowFinish = callback;
        },
      } as unknown as Response;
      metricsMiddleware({ method: 'GET', path: `/overflow/${i}` } as unknown as Request, overflowRes, vi.fn());
      overflowFinish();
    }
    expect(metricsSnapshot().length).toBeLessThanOrEqual(1000);

    const snapshot = metricsSnapshot();
    expect(snapshot[0].avgDurationMs).toBeGreaterThanOrEqual(0);

    persistMetrics(dataDir, snapshot);
    expect(fs.existsSync(path.join(dataDir, 'metrics.json'))).toBe(true);

    vi.spyOn(fs, 'writeFileSync').mockImplementation(() => {
      throw new Error('disk full');
    });
    expect(() => persistMetrics(dataDir, snapshot)).not.toThrow();
  });

  it('covers trace and error middleware branches', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const badRequest = { header: () => 'bad!', traceId: '' } as unknown as Request;
    const response = { setHeader: vi.fn(), statusCode: 200, status: vi.fn(() => response), json: vi.fn(() => response) } as unknown as Response;
    traceMiddleware(badRequest, response, vi.fn());
    expect(badRequest.traceId).not.toBe('bad!');

    errorMiddleware(new AppError('SERVER', 'boom', 500), badRequest, response, vi.fn());
    expect(consoleSpy).toHaveBeenCalledOnce();
    expect((response.json as ReturnType<typeof vi.fn>).mock.calls[0][0].message).toBe('Internal server error');

    const logger = new Logger({ logDir: dataDir });
    const loggerSpy = vi.spyOn(logger, 'error');
    errorMiddleware(new AppError('SERVER', 'boom', 500), badRequest, response, vi.fn(), logger);
    expect(loggerSpy).toHaveBeenCalledOnce();
  });

  it('covers auth middleware token and context paths', async () => {
    const auth = {
      verifyToken: vi.fn(() => ({
        sub: 'user-1',
        clinicId: 'clinic-1',
        role: 'BOSS',
        tokenVersion: 0,
      })),
      isClinicAccessible: vi.fn(() => true),
      effectivePermissions: vi.fn(() => []),
      getUserById: vi.fn(async () => ({
        id: 'user-1',
        clinicId: 'clinic-1',
        role: 'BOSS',
        tokenVersion: 0,
        active: true,
        lockedUntil: null,
      })),
    } as unknown as AuthService;
    const middleware = authMiddleware(auth);
    const response = { setHeader: vi.fn(), statusCode: 200, status: vi.fn(() => response), json: vi.fn(() => response) } as unknown as Response;
    const next: NextFunction = vi.fn();

    const missing = { header: () => '', traceId: 'trace' } as unknown as Request;
    await middleware(missing, response, next);
    expect(next).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHORIZED' }));

    const invalid = { header: () => 'Bearer bad', traceId: 'trace' } as unknown as Request;
    (auth.verifyToken as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new AppError('UNAUTHORIZED', 'invalid', 401);
    });
    await middleware(invalid, response, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'UNAUTHORIZED' }));

    (auth.verifyToken as ReturnType<typeof vi.fn>).mockReturnValue({
      sub: 'user-1',
      clinicId: 'clinic-1',
      role: 'BOSS',
      tokenVersion: 0,
    });
    const valid = { header: () => 'Bearer valid', traceId: 'trace' } as unknown as Request;
    await middleware(valid, response, next);
    expect(valid).toHaveProperty('context');

    (auth.getUserById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'user-1', clinicId: 'clinic-1', role: 'BOSS', tokenVersion: 0, active: false, lockedUntil: null,
    });
    await middleware({ header: () => 'Bearer valid', traceId: 'trace' } as unknown as Request, response, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'User is disabled' }));

    (auth.getUserById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'user-1', clinicId: 'clinic-1', role: 'BOSS', tokenVersion: 0, active: true,
      lockedUntil: new Date(Date.now() + 60_000).toISOString(),
    });
    await middleware({ header: () => 'Bearer valid', traceId: 'trace' } as unknown as Request, response, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'Account is temporarily locked' }));

    (auth.getUserById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'user-1', clinicId: 'clinic-1', role: 'BOSS', tokenVersion: 999, active: true, lockedUntil: null,
    });
    await middleware({ header: () => 'Bearer valid', traceId: 'trace' } as unknown as Request, response, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'Token is no longer valid' }));

    (auth.getUserById as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'user-1', clinicId: null, role: 'BOSS', tokenVersion: 0, active: true, lockedUntil: null,
    });
    const nullClinic = { header: () => 'Bearer valid', traceId: 'trace' } as unknown as Request;
    await middleware(nullClinic, response, next);
    expect(nullClinic).toHaveProperty('context');
    expect((nullClinic as Request & { context?: { clinicId: string | null } }).context?.clinicId).toBe('clinic-1');
  });

  it('covers role middleware missing context and rate limiter window reset', () => {
    const response = { statusCode: 200, setHeader: vi.fn(), status: vi.fn(() => response), json: vi.fn(() => response) } as unknown as Response;
    const next: NextFunction = vi.fn();
    const missing = {} as Request;
    const denied = { context: { role: 'RECEPTIONIST' } } as unknown as Request;
    const allowed = { context: { role: 'BOSS' } } as unknown as Request;
    roleMiddleware('BOSS')(missing, response, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'UNAUTHORIZED' }));
    roleMiddleware('BOSS')(denied, response, next);
    expect(next).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'FORBIDDEN' }));
    roleMiddleware('BOSS')(allowed, response, next);
    expect(next).toHaveBeenCalledTimes(3);

    vi.useFakeTimers();
    const limiter = createRateLimit({ windowMs: 1000, max: 2 });
    limiter({ ip: '1.1.1.1', method: 'GET', path: '/x' } as unknown as Request, response, next);
    vi.advanceTimersByTime(1001);
    limiter({ ip: '1.1.1.1', method: 'GET', path: '/x' } as unknown as Request, response, next);
    expect(next).toHaveBeenCalledTimes(5);

    for (let i = 0; i < 10001; i += 1) {
      limiter({ ip: `overflow-${i}`, method: 'GET', path: '/x' } as unknown as Request, response, next);
    }
    expect(next).toHaveBeenCalled();
  });

  it('covers remaining validation branches', () => {
    const resource: ResourceDefinition = {
      name: 'coverage',
      table: 'Coverage',
      fields: [
        { name: 'text', type: 'text' },
        { name: 'longText', type: 'longText' },
        { name: 'date', type: 'date' },
        { name: 'datetime', type: 'datetime' },
        { name: 'relation', type: 'relation' },
        { name: 'number', type: 'number', min: 0, max: 10 },
        { name: 'money', type: 'money' },
        { name: 'bool', type: 'boolean' },
        { name: 'enum', type: 'enum', enumValues: ['A'] },
        { name: 'json', type: 'json' },
        { name: 'custom', type: 'custom' } as unknown as ResourceField,
      ],
      searchableFields: ['text'],
      defaultSort: { field: 'text', order: 'ASC' },
      capabilities: { list: true, create: true, update: true, delete: true, softDelete: true },
      roles: ['BOSS'],
    };
    const payload = validatePayload(resource, {
      text: 'a',
      longText: 'b',
      date: '2026-01-01',
      datetime: '2026-01-01T00:00:00.000Z',
      relation: 'patient-1',
      number: 1,
      money: 100,
      bool: false,
      enum: 'A',
      json: '{"x":1}',
      custom: 'raw',
    });
    expect(payload.bool).toBe(false);
    expect(payload.custom).toBe('raw');
    expect(validatePayload(resource, { json: { x: 1 } }).json).toEqual({ x: 1 });
    expect(validatePayload(resource, { json: [{ x: 1 }] }).json).toEqual([{ x: 1 }]);
    expect(() => validatePayload(resource, { json: 1 })).toThrow('JSON-compatible');
    expect(() => validatePayload(resource, { text: null, number: -1 })).toThrow('number must be >= 0');
    expect(() => validatePayload(resource, { number: 'bad' })).toThrow('number must be a number');
    expect(() => validatePayload(resource, { text: 1 })).toThrow('text must be a string');
    expect(() => validatePayload(resource, { enum: 'B' })).toThrow('enum must be one of');
  });

  it('covers logger file output, rotation, and append failure', () => {
    const infoSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = new Logger({ logDir: dataDir });
    logger.info('info message');
    logger.warn('warn message');
    logger.error('error message');
    logger.flush();
    expect(infoSpy).toHaveBeenCalledOnce();
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(fs.existsSync(path.join(dataDir, 'v2.log'))).toBe(true);

    const bigLog = path.join(dataDir, 'v2.log');
    fs.writeFileSync(bigLog, 'x'.repeat(5 * 1024 * 1024 + 1), 'utf8');
    logger.info('rotated');
    logger.flush();
    expect(fs.existsSync(`${bigLog}.1`)).toBe(true);

    vi.spyOn(fs, 'appendFileSync').mockImplementation(() => {
      throw new Error('append failed');
    });
    expect(() => logger.info('silent')).not.toThrow();
    expect(() => logger.flush()).not.toThrow();
  });

  it('covers legacy import logging and backup creation branches', () => {
    const sourcePath = path.join(dataDir, 'source.sqlite');
    const targetPath = path.join(dataDir, 'target.sqlite');
    const source = new DatabaseClass(sourcePath);
    source.exec('CREATE TABLE Patient (id TEXT PRIMARY KEY, name TEXT)');
    source.close();
    const logger = new Logger({ logDir: dataDir });
    const infoSpy = vi.spyOn(logger, 'info');
    // B-L6：backupSqliteFile 只对合法 SQLite 文件做 checkpoint + VACUUM INTO 备份；
    // target 必须先是一个有效数据库，否则备份直接抛错（不再裸拷贝）。
    const target = new DatabaseClass(targetPath);
    target.exec('CREATE TABLE OldData (id TEXT PRIMARY KEY)');
    target.close();
    const result = importLegacyDatabase(sourcePath, targetPath, logger);
    expect(result.imported).toBe(true);
    expect(result.backupCreated).toBeDefined();
    expect(infoSpy).toHaveBeenCalledOnce();

    const missing = importLegacyDatabase(path.join(dataDir, 'missing.sqlite'), path.join(dataDir, 'out.sqlite'));
    expect(missing.imported).toBe(false);
  });

  it('covers idempotency without a key', async () => {
    let calls = 0;
    const result = await withIdempotency({} as Database.Database, { operation: 'x', userId: 'u', clinicId: 'c', requestId: '' }, () => {
      calls += 1;
      return { value: 1 };
    });
    expect(result.value).toBe(1);
    expect(calls).toBe(1);
  });

  it('covers an empty metrics snapshot', async () => {
    vi.resetModules();
    const freshMetrics = await import('./http/metrics');
    expect(freshMetrics.metricsSnapshot()).toEqual([]);
  });
});
