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
});
