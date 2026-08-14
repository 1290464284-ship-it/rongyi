import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from './database';
import type { Logger } from './logger';

describe('seedDatabase edge paths', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-seed-edge-'));
    db = createDatabase(dataDir);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('warns through the logger and prints the dev password when NODE_ENV is unset', () => {
    vi.stubEnv('NODE_ENV', undefined);
    vi.stubEnv('V2_ADMIN_PASSWORD', undefined);
    const warns: Array<Array<unknown>> = [];
    const logger = {
      warn: (...args: unknown[]) => {
        warns.push(args);
      },
    } as unknown as Logger;
    const devWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedDatabase(db, logger);
    // 临时口令告警（line 66）+ 默认口令稳定性告警（line 77）
    expect(warns.length).toBeGreaterThanOrEqual(2);
    expect(devWarn.mock.calls.some(([message]) => String(message).includes('development admin temporary password'))).toBe(true);
  });

  it('throws when the production bootstrap password is too short', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('V2_ADMIN_PASSWORD', '123');
    expect(() => seedDatabase(db)).toThrow('V2_ADMIN_PASSWORD must be at least 6 characters');
  });

  it('stays silent when the production bootstrap insert inserts nothing', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('V2_ADMIN_PASSWORD', 'long-enough-password');
    const warns: Array<Array<unknown>> = [];
    const logger = {
      warn: (...args: unknown[]) => {
        warns.push(args);
      },
    } as unknown as Logger;
    const originalPrepare = db.prepare.bind(db);
    vi.spyOn(db, 'prepare').mockImplementation((sql: string) => {
      if (sql.includes('INSERT OR IGNORE INTO User')) {
        return { run: () => ({ changes: 0 }) } as unknown as ReturnType<Database.Database['prepare']>;
      }
      return originalPrepare(sql);
    });
    seedDatabase(db, logger);
    expect(warns).toHaveLength(0);
  });

  it('treats a non-dev non-test environment without a dev password print', () => {
    vi.stubEnv('NODE_ENV', 'staging');
    vi.stubEnv('V2_ADMIN_PASSWORD', undefined);
    const warns: Array<Array<unknown>> = [];
    const logger = {
      warn: (...args: unknown[]) => {
        warns.push(args);
      },
    } as unknown as Logger;
    const devWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    seedDatabase(db, logger);
    expect(devWarn).not.toHaveBeenCalled();
    expect(warns.length).toBeGreaterThanOrEqual(2);
  });
});
