import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from '../infrastructure/database';
import type { Logger } from '../infrastructure/logger';
import { createAuditBuffer } from './audit-buffer';

describe('createAuditBuffer production paths', () => {
  let db: Database.Database;
  let dataDir: string;
  const originalNodeEnv = process.env.NODE_ENV;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-audit-buffer-'));
    db = createDatabase(dataDir);
    db.exec('ALTER TABLE OperationLog ADD COLUMN statusCode TEXT');
  });

  afterEach(() => {
    db.exec('DROP TRIGGER IF EXISTS op_log_fail');
    vi.useRealTimers();
    vi.restoreAllMocks();
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function failOperationLog(): void {
    db.exec(`
      CREATE TRIGGER op_log_fail
      BEFORE INSERT ON OperationLog
      BEGIN
        SELECT RAISE(ABORT, 'audit flush failed');
      END
    `);
  }

  it('logs shutdown flush failures through the logger', () => {
    process.env.NODE_ENV = 'production';
    failOperationLog();
    const logger = { error: vi.fn() } as unknown as Logger;
    const buffer = createAuditBuffer(db, logger);
    buffer.push({ action: 'test.shutdown' });
    buffer.flushNow();
    expect(logger.error).toHaveBeenCalledWith('audit shutdown flush failed', expect.anything());
  });

  it('falls back to console.error when no logger is available', () => {
    process.env.NODE_ENV = 'production';
    failOperationLog();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const buffer = createAuditBuffer(db, undefined as unknown as Logger);
    buffer.push({ action: 'test.console' });
    buffer.flushNow();
    expect(consoleError).toHaveBeenCalledWith('[audit-buffer] audit shutdown flush failed', expect.anything());
  });

  it('logs scheduled flush and retry failures', async () => {
    process.env.NODE_ENV = 'production';
    vi.useFakeTimers();
    failOperationLog();
    const logger = { error: vi.fn() } as unknown as Logger;
    const buffer = createAuditBuffer(db, logger);
    buffer.push({ action: 'test.scheduled' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(logger.error).toHaveBeenCalledWith('audit batch flush failed', expect.anything());
    await vi.advanceTimersByTimeAsync(1000);
    expect(logger.error).toHaveBeenCalledWith('audit batch retry flush failed', expect.anything());
  });

  it('logs immediate full-buffer flush failures and the single retry', async () => {
    process.env.NODE_ENV = 'production';
    vi.useFakeTimers();
    failOperationLog();
    const logger = { error: vi.fn() } as unknown as Logger;
    const buffer = createAuditBuffer(db, logger);
    for (let i = 0; i < 50; i += 1) {
      buffer.push({ action: `test.full.${i}` });
    }
    expect(logger.error).toHaveBeenCalledWith('audit batch flush failed', expect.anything());
    await vi.advanceTimersByTimeAsync(1000);
    expect(logger.error).toHaveBeenCalledWith('audit batch retry flush failed', expect.anything());
  });

  it('falls back to console.error for scheduled and retry flush failures', async () => {
    process.env.NODE_ENV = 'production';
    vi.useFakeTimers();
    failOperationLog();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const buffer = createAuditBuffer(db, undefined as unknown as Logger);
    buffer.push({ action: 'test.scheduled-console' });
    await vi.advanceTimersByTimeAsync(1000);
    expect(consoleError).toHaveBeenCalledWith('[audit-buffer] audit batch flush failed', expect.anything());
    await vi.advanceTimersByTimeAsync(1000);
    expect(consoleError).toHaveBeenCalledWith('[audit-buffer] audit batch retry flush failed', expect.anything());
  });

  it('falls back to console.error when a full-buffer push flush fails', () => {
    process.env.NODE_ENV = 'production';
    vi.useFakeTimers();
    failOperationLog();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const buffer = createAuditBuffer(db, undefined as unknown as Logger);
    for (let i = 0; i < 50; i += 1) {
      buffer.push({ action: `test.full-console.${i}` });
    }
    expect(consoleError).toHaveBeenCalledWith('[audit-buffer] audit batch flush failed', expect.anything());
  });

  it('drops overflow rows through the logger when the retry buffer saturates', () => {
    process.env.NODE_ENV = 'production';
    vi.useFakeTimers();
    failOperationLog();
    const logger = { error: vi.fn() } as unknown as Logger;
    const buffer = createAuditBuffer(db, logger);
    // 第一批：满 50 立即刷出失败 → 重试在途，50 行放回缓冲。
    for (let i = 0; i < 50; i += 1) buffer.push({ action: `test.sat.${i}` });
    // 第二批：缓冲涨到 100（每次 push 均触发刷出失败 + 重试队尾归位）。
    for (let i = 0; i < 50; i += 1) buffer.push({ action: `test.sat2.${i}` });
    // 第三批首个 push：缓冲 101 → splice 50 → 剩 51 → room 49 → 1 行超容量丢弃。
    buffer.push({ action: 'test.sat3.0' });
    expect(logger.error).toHaveBeenCalledWith(
      'audit rows dropped (retry buffer over capacity)',
      expect.objectContaining({ action: 'audit-drop', dropped: 1 }),
    );
  });

  it('drops overflow rows through console.error without a logger', () => {
    process.env.NODE_ENV = 'production';
    vi.useFakeTimers();
    failOperationLog();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const buffer = createAuditBuffer(db, undefined as unknown as Logger);
    for (let i = 0; i < 50; i += 1) buffer.push({ action: `test.satc.${i}` });
    for (let i = 0; i < 50; i += 1) buffer.push({ action: `test.satc2.${i}` });
    buffer.push({ action: 'test.satc3.0' });
    expect(consoleError).toHaveBeenCalledWith(
      '[audit-buffer] audit rows dropped (retry buffer over capacity)',
      1,
    );
  });

  it('stores null optional fields in test mode', () => {
    process.env.NODE_ENV = 'test';
    const buffer = createAuditBuffer(db, undefined as unknown as Logger);
    buffer.push({ action: 'test.null-fields' });
    const row = db.prepare(
      `SELECT ip, traceId, statusCode FROM OperationLog WHERE action = 'test.null-fields' ORDER BY rowid DESC LIMIT 1`,
    ).get() as { ip: string | null; traceId: string | null; statusCode: string | null };
    expect(row.ip).toBeNull();
    expect(row.traceId).toBeNull();
    expect(row.statusCode).toBeNull();
  });
});
