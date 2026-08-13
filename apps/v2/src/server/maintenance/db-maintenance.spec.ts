import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import {
  enableIncrementalAutoVacuum,
  runDailyDatabaseMaintenance,
  runWeeklyDatabaseMaintenance,
  type MaintenanceAlert,
} from './db-maintenance';
import type { Logger } from '../infrastructure/logger';

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
}

describe('runDailyDatabaseMaintenance', () => {
  it('runs quick_check, optimize and checkpoint on a healthy database without alerts', () => {
    const db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    const alerts: MaintenanceAlert[] = [];
    const result = runDailyDatabaseMaintenance({ db, logger: makeLogger(), onAlert: (a) => alerts.push(a) });
    expect(result).toEqual({ integrityOk: true, optimizeOk: true, checkpointed: true, autoVacuum: 0 });
    expect(alerts).toHaveLength(0);
    db.close();
  });

  it('creates a CRITICAL alert when quick_check fails', () => {
    const failing = {
      pragma: vi.fn((source: string) => {
        if (source === 'quick_check') return [{ quick_check: 'not ok' }];
        return '1';
      }),
    } as unknown as Database.Database;
    const alerts: MaintenanceAlert[] = [];
    const result = runDailyDatabaseMaintenance({ db: failing, logger: makeLogger(), onAlert: (a) => alerts.push(a) });
    expect(result.integrityOk).toBe(false);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ alertType: 'DB_INTEGRITY_FAILURE', level: 'CRITICAL', severity: 'CRITICAL' });
  });

  it('treats a throwing quick_check as integrity failure without rethrowing', () => {
    const failing = {
      pragma: vi.fn((source: string) => {
        if (source === 'quick_check') throw new Error('database locked');
        return '1';
      }),
    } as unknown as Database.Database;
    const alerts: MaintenanceAlert[] = [];
    const result = runDailyDatabaseMaintenance({ db: failing, logger: makeLogger(), onAlert: (a) => alerts.push(a) });
    expect(result.integrityOk).toBe(false);
    expect(alerts).toHaveLength(1);
  });

  it('records optimize/checkpoint failures in the result without alerting', () => {
    const db = {
      pragma: vi.fn((source: string) => {
        if (source === 'quick_check') return [{ quick_check: 'ok' }];
        if (source === 'optimize') throw new Error('optimize failed');
        if (source === 'wal_checkpoint(PASSIVE)') throw new Error('checkpoint failed');
        return '1';
      }),
    } as unknown as Database.Database;
    const alerts: MaintenanceAlert[] = [];
    const result = runDailyDatabaseMaintenance({ db, logger: makeLogger(), onAlert: (a) => alerts.push(a) });
    expect(result).toMatchObject({ integrityOk: true, optimizeOk: false, checkpointed: false });
    expect(alerts).toHaveLength(0);
  });
});

describe('runWeeklyDatabaseMaintenance', () => {
  it('reclaims freelist pages with incremental_vacuum when auto_vacuum is INCREMENTAL', () => {
    const db = new Database(':memory:');
    db.pragma('auto_vacuum = INCREMENTAL');
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
    const insert = db.prepare('INSERT INTO t (v) VALUES (?)');
    db.transaction(() => {
      for (let i = 0; i < 500; i += 1) insert.run(`v${i}`);
    })();
    db.exec('DELETE FROM t WHERE id % 2 = 0');
    const freelistBefore = Number(db.pragma('freelist_count', { simple: true }));
    expect(freelistBefore).toBeGreaterThan(0);
    const result = runWeeklyDatabaseMaintenance({ db, logger: makeLogger(), onAlert: vi.fn() });
    const freelistAfter = Number(db.pragma('freelist_count', { simple: true }));
    expect(result.vacuumedPages).toBe(freelistBefore - freelistAfter);
    expect(result.vacuumedPages).toBeGreaterThan(0);
    db.close();
  });

  it('skips when not INCREMENTAL and full vacuum is disabled', () => {
    const db = new Database(':memory:');
    const result = runWeeklyDatabaseMaintenance({
      db,
      logger: makeLogger(),
      onAlert: vi.fn(),
      allowFullVacuum: false,
    });
    expect(result.vacuumedPages).toBe(0);
    expect(result.skippedReason).toContain('full vacuum is disabled');
    db.close();
  });

  it('runs a full vacuum when explicitly allowed', () => {
    const db = new Database(':memory:');
    const exec = vi.spyOn(db, 'exec');
    const result = runWeeklyDatabaseMaintenance({
      db,
      logger: makeLogger(),
      onAlert: vi.fn(),
      allowFullVacuum: true,
    });
    expect(result.vacuumedPages).toBe(0);
    expect(exec).toHaveBeenCalledWith('VACUUM');
    db.close();
  });
});

describe('enableIncrementalAutoVacuum', () => {
  it('returns true when already INCREMENTAL without touching env', () => {
    const db = new Database(':memory:');
    db.pragma('auto_vacuum = INCREMENTAL');
    expect(enableIncrementalAutoVacuum(db, makeLogger())).toBe(true);
    db.close();
  });

  it('returns false when the env flag is not set', () => {
    const db = new Database(':memory:');
    expect(enableIncrementalAutoVacuum(db, makeLogger())).toBe(false);
    db.close();
  });

  it('migrates to INCREMENTAL when the env flag is set', () => {
    const db = new Database(':memory:');
    process.env.V2_ENABLE_AUTO_VACUUM = '1';
    try {
      expect(enableIncrementalAutoVacuum(db, makeLogger())).toBe(true);
      expect(Number(db.pragma('auto_vacuum', { simple: true }))).toBe(2);
    } finally {
      delete process.env.V2_ENABLE_AUTO_VACUUM;
    }
    db.close();
  });
});
