import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from './database';
import { cleanupIdempotencyRecords, withIdempotency, type IdempotencyScope } from './idempotency';
import { isDbWriteActive, sharedDbWriteQueue } from './db-write-queue';
import { ValidationError } from './errors';

const scope = (requestId: string, overrides: Partial<IdempotencyScope> = {}): IdempotencyScope => ({
  operation: 'charge.pay',
  userId: 'user-1',
  clinicId: 'clinic-1',
  requestId,
  resourceId: 'charge-1',
  ...overrides,
});

function scopeKey(input: IdempotencyScope): string {
  return createHash('sha256')
    .update([input.operation, input.resourceId ?? '', input.userId ?? '', input.clinicId ?? '', input.requestId].join('\0'))
    .digest('hex');
}

describe('withIdempotency', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-idem-'));
    db = createDatabase(dataDir);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('runs the operation once for the same key', async () => {
    let calls = 0;
    const first = await withIdempotency(db, scope('key-1'), () => {
      calls += 1;
      return { value: 1 };
    });
    const second = await withIdempotency(db, scope('key-1'), () => {
      calls += 1;
      return { value: 2 };
    });
    expect(first.value).toBe(1);
    expect(second.value).toBe(1);
    expect(calls).toBe(1);
  });

  it('recovers from a corrupt completed response by deleting the record and re-running', async () => {
    const key = scopeKey(scope('corrupt-response'));
    db.prepare(
      `INSERT INTO IdempotencyRecord (
         id, key, type, status, responseJson, result, userId, clinicId, operation,
         createdAt, updatedAt, deletedAt, expiresAt
       ) VALUES (?, ?, 'GENERIC', 'COMPLETED', 'not-json', '{}', 'user-1', 'clinic-1', 'charge.pay', ?, ?, NULL, ?)`,
    ).run(
      'idem-corrupt-response',
      key,
      new Date().toISOString(),
      new Date().toISOString(),
      new Date(Date.now() + 86_400_000).toISOString(),
    );
    let calls = 0;
    const result = await withIdempotency(db, scope('corrupt-response'), () => {
      calls += 1;
      return { recovered: true };
    });
    expect(result).toEqual({ recovered: true });
    expect(calls).toBe(1);
  });

  it('isolates keys by operation, user, clinic, and request id', async () => {
    let calls = 0;
    const first = await withIdempotency(db, scope('shared', { operation: 'charge.pay' }), () => {
      calls += 1;
      return { operation: 'pay' };
    });
    const second = await withIdempotency(db, scope('shared', { operation: 'charge.refund', userId: 'user-2', clinicId: 'clinic-2' }), () => {
      calls += 1;
      return { operation: 'refund' };
    });
    expect(first.operation).toBe('pay');
    expect(second.operation).toBe('refund');
    expect(calls).toBe(2);
  });

  it('allows retry after the operation throws', async () => {
    let calls = 0;
    expect(() => withIdempotency(db, scope('key-2'), () => {
      calls += 1;
      throw new Error('boom');
    })).toThrow('boom');
    const result = await withIdempotency(db, scope('key-2'), () => {
      calls += 1;
      return { ok: true };
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('rejects non-async callbacks that return promises instead of marking them completed', async () => {
    let calls = 0;
    expect(() => withIdempotency(db, scope('promise-sync'), () => {
      calls += 1;
      return Promise.resolve({ ok: true });
    })).toThrow('must complete synchronously');
    expect(calls).toBe(1);
    // 同步路径失败会回滚并删除 PROCESSING 记录，允许用正确写法重试。
    const result = await withIdempotency(db, scope('promise-sync'), async () => {
      calls += 1;
      return { ok: true };
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  it('wraps synchronous operations without a request id in a rollback-safe transaction', () => {
    db.exec('CREATE TABLE IF NOT EXISTS IdemScratch (id TEXT PRIMARY KEY)');
    const noRequestScope = (key: string) => ({ ...scope(key), requestId: '' });
    expect(() => withIdempotency(db, noRequestScope('rollback'), () => {
      db.prepare('INSERT INTO IdemScratch (id) VALUES (?)').run('rolled-back');
      throw new Error('boom');
    })).toThrow('boom');
    expect(db.prepare('SELECT 1 FROM IdemScratch WHERE id = ?').get('rolled-back')).toBeUndefined();

    const result = withIdempotency(db, noRequestScope('commit'), () => {
      db.prepare('INSERT INTO IdemScratch (id) VALUES (?)').run('committed');
      return { ok: true };
    });
    expect(result).toEqual({ ok: true });
    expect(db.prepare('SELECT 1 FROM IdemScratch WHERE id = ?').get('committed')).toBeDefined();
  });

  it('keeps the PROCESSING record when an async operation fails, blocking retries', async () => {
    let calls = 0;
    await expect(withIdempotency(db, scope('async-fail'), async () => {
      calls += 1;
      throw new Error('async boom');
    })).rejects.toThrow('async boom');
    // The failed async operation may have partially taken effect and cannot be
    // rolled back, so a retry must not re-run it: the PROCESSING record is kept.
    expect(() => withIdempotency(db, scope('async-fail'), async () => {
      calls += 1;
      return { ok: true };
    })).toThrow('Operation is already in progress');
    const row = db.prepare('SELECT status FROM IdempotencyRecord WHERE key = ?').get(scopeKey(scope('async-fail')));
    expect(row).toEqual({ status: 'PROCESSING' });
    expect(calls).toBe(1);
    // Cleanup reclaims the stuck record after the processing timeout.
    db.prepare(
      `UPDATE IdempotencyRecord SET updatedAt = ? WHERE key = ?`,
    ).run(new Date(Date.now() - 60 * 60 * 1000).toISOString(), scopeKey(scope('async-fail')));
    const { deleted } = cleanupIdempotencyRecords(db);
    expect(deleted).toBeGreaterThanOrEqual(1);
    const result = await withIdempotency(db, scope('async-fail'), async () => {
      calls += 1;
      return { ok: true };
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('rejects an existing processing record', () => {
    const key = scopeKey(scope('existing-processing'));
    db.prepare(
      `INSERT INTO IdempotencyRecord (
         id, key, type, status, responseJson, result, userId, clinicId, operation,
         createdAt, updatedAt, deletedAt, expiresAt
       ) VALUES (?, ?, 'GENERIC', 'PROCESSING', '{}', '{}', 'user-1', 'clinic-1', 'charge.pay', ?, ?, NULL, ?)`,
    ).run('idem-processing', key, new Date().toISOString(), new Date().toISOString(), new Date(Date.now() + 86_400_000).toISOString());
    expect(() => withIdempotency(db, scope('existing-processing'), () => ({ ok: true })))
      .toThrow('Operation is already in progress');
  });

  it('no longer auto-deletes stale processing records in the hot path', () => {
    const key = scopeKey(scope('stale-processing'));
    db.prepare(
      `INSERT INTO IdempotencyRecord (
         id, key, type, status, responseJson, result, userId, clinicId, operation,
         createdAt, updatedAt, deletedAt, expiresAt
       ) VALUES (?, ?, 'GENERIC', 'PROCESSING', '{}', '{}', 'user-1', 'clinic-1', 'charge.pay', ?, ?, NULL, ?)`,
    ).run(
      'idem-stale-processing',
      key,
      new Date(Date.now() - 3_600_000).toISOString(),
      new Date(Date.now() - 3_600_000).toISOString(),
      new Date(Date.now() + 86_400_000).toISOString(),
    );
    let calls = 0;
    expect(() => withIdempotency(db, scope('stale-processing'), () => {
      calls += 1;
      return { ok: true };
    })).toThrow('Operation is already in progress');
    expect(calls).toBe(0);
    const row = db.prepare('SELECT status FROM IdempotencyRecord WHERE key = ?').get(key);
    expect(row).toEqual({ status: 'PROCESSING' });
  });

  it('deletes the PROCESSING record when an async operation fails with a known business error', async () => {
    await expect(withIdempotency(db, scope('async-validation'), async () => {
      throw new ValidationError('bad input');
    })).rejects.toThrow('bad input');
    await expect(withIdempotency(db, scope('async-validation'), async () => 'ok')).resolves.toBe('ok');
  });

  it('treats expired completed records as retryable', async () => {
    const key = scopeKey(scope('expired'));
    db.prepare(
      `INSERT INTO IdempotencyRecord (
         id, key, type, status, responseJson, result, userId, clinicId, operation,
         createdAt, updatedAt, deletedAt, expiresAt
       ) VALUES (?, ?, 'GENERIC', 'COMPLETED', '{"old":true}', '{}', 'user-1', 'clinic-1', 'charge.pay', ?, ?, NULL, ?)`,
    ).run('idem-expired', key, new Date().toISOString(), new Date().toISOString(), new Date(Date.now() - 1000).toISOString());
    let calls = 0;
    const result = await withIdempotency(db, scope('expired'), () => {
      calls += 1;
      return { fresh: true };
    });
    expect(result.fresh).toBe(true);
    expect(calls).toBe(1);
  });

  it('rethrows a failed idempotency record insert', () => {
    const key = scopeKey(scope('race'));
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS idempotency_fail_insert
      AFTER INSERT ON IdempotencyRecord
      WHEN NEW.key = '${key}'
      BEGIN
        SELECT RAISE(ABORT, 'race insert failed');
      END
    `);
    expect(() => withIdempotency(db, scope('race'), () => ({ ok: true })))
      .toThrow('race insert failed');
  });

  it('removes the processing record when completing a sync operation fails', () => {
    const get = vi.fn().mockReturnValueOnce(undefined);
    const insertRun = vi.fn();
    const updateRun = vi.fn(() => {
      throw new Error('update failed');
    });
    const deleteRun = vi.fn();
    const prepare = vi.fn((sql: string) => {
      if (sql.startsWith('DELETE FROM IdempotencyRecord')) return { run: deleteRun };
      if (sql.includes('SELECT responseJson')) return { get };
      if (sql.startsWith('INSERT INTO IdempotencyRecord')) return { run: insertRun };
      if (sql.startsWith('UPDATE IdempotencyRecord')) return { run: updateRun };
      return { run: vi.fn() };
    });
    const failingDb = {
      prepare,
      transaction: (fn: () => unknown) => fn(),
      exec: vi.fn(),
    } as unknown as Database.Database;
    expect(() => withIdempotency(failingDb, scope('update-failure'), () => ({ ok: true })))
      .toThrow('update failed');
    // Only the single-key cleanup DELETE runs — the hot-path table sweep was removed.
    expect(deleteRun).toHaveBeenCalledTimes(1);
  });

  it('rolls back business side effects when the completed update fails', () => {
    const originalPrepare = db.prepare.bind(db);
    const spy = vi.spyOn(db, 'prepare');
    spy.mockImplementation((sql: string) => {
      const statement = originalPrepare(sql);
      if (sql.includes("status = 'COMPLETED'")) {
        const failing = statement as unknown as { run: () => never };
        failing.run = () => {
          throw new Error('injected completed update failure');
        };
      }
      return statement;
    });
    try {
      expect(() =>
        withIdempotency(db, scope('atomic-failure'), () => {
          // A business side effect committed through the operation's own write path.
          db.prepare(
            `INSERT INTO IdempotencyRecord (
               id, key, type, status, responseJson, result, userId, clinicId, operation,
               createdAt, updatedAt, deletedAt, expiresAt
             ) VALUES (?, ?, 'GENERIC', 'COMPLETED', '{}', '{}', 'user-1', 'clinic-1', 'charge.pay', ?, ?, NULL, ?)`,
          ).run(
            'business-side-effect',
            'some-other-key',
            new Date().toISOString(),
            new Date().toISOString(),
            new Date(Date.now() + 86_400_000).toISOString(),
          );
          return { ok: true };
        }),
      ).toThrow('injected completed update failure');
    } finally {
      spy.mockRestore();
    }
    // The failed completion must roll back the business side effect with it.
    expect(db.prepare('SELECT id FROM IdempotencyRecord WHERE id = ?').get('business-side-effect')).toBeUndefined();
    // The processing record was removed, so the same key is retryable.
    const retried = withIdempotency(db, scope('atomic-failure'), () => ({ ok: 'retried' }));
    expect(retried).toEqual({ ok: 'retried' });
  });

  it('returns a concurrent result when the idempotency insert races', async () => {
    const raceDb = createRaceDb({ responseJson: '{"ok":true}', status: 'COMPLETED' });
    expect(await withIdempotency(raceDb, scope('race-concurrent'), () => ({ ok: false }))).toEqual({ ok: true });
  });

  it('rejects concurrent processing records instead of returning an empty placeholder', () => {
    const raceDb = createRaceDb({ responseJson: '{}', status: 'PROCESSING' });
    expect(() => withIdempotency(raceDb, scope('race-processing'), () => ({ ok: false })))
      .toThrow('Operation is already in progress');
  });
});

describe('cleanupIdempotencyRecords', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-idem-cleanup-'));
    db = createDatabase(dataDir);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertRecord(id: string, key: string, status: string, updatedAt: Date): void {
    db.prepare(
      `INSERT INTO IdempotencyRecord (
         id, key, type, status, responseJson, result, userId, clinicId, operation,
         createdAt, updatedAt, deletedAt, expiresAt
       ) VALUES (?, ?, 'GENERIC', ?, '{}', '{}', 'user-1', 'clinic-1', 'charge.pay', ?, ?, NULL, ?)`,
    ).run(id, key, status, updatedAt.toISOString(), updatedAt.toISOString(), new Date(Date.now() + 86_400_000).toISOString());
  }

  it('deletes processing records past the recovery timeout', () => {
    const key = scopeKey(scope('cleanup-stale'));
    insertRecord('idem-cleanup-stale', key, 'PROCESSING', new Date(Date.now() - 3_600_000));
    const { deleted } = cleanupIdempotencyRecords(db);
    expect(deleted).toBe(1);
    expect(db.prepare('SELECT 1 FROM IdempotencyRecord WHERE key = ?').get(key)).toBeUndefined();
  });

  it('keeps fresh processing records and all completed records', () => {
    const freshKey = scopeKey(scope('cleanup-fresh'));
    const completedKey = scopeKey(scope('cleanup-completed'));
    insertRecord('idem-cleanup-fresh', freshKey, 'PROCESSING', new Date());
    insertRecord('idem-cleanup-completed', completedKey, 'COMPLETED', new Date(Date.now() - 3_600_000));
    const { deleted } = cleanupIdempotencyRecords(db);
    expect(deleted).toBe(0);
    expect(db.prepare('SELECT status FROM IdempotencyRecord WHERE key = ?').get(freshKey)).toEqual({ status: 'PROCESSING' });
    expect(db.prepare('SELECT status FROM IdempotencyRecord WHERE key = ?').get(completedKey)).toEqual({ status: 'COMPLETED' });
  });

  it('rejects sync writes with a retryable error while another writer holds the db queue', async () => {
    const queue = sharedDbWriteQueue(db);
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const pending = queue(async () => {
      await gate;
      return 'done';
    });
    // 队列在微任务中启动，等一拍让 active 计数生效。
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(isDbWriteActive(db)).toBe(true);
    expect(() => withIdempotency(db, scope('busy'), () => ({ ok: true })))
      .toThrow('Database write is in progress');
    release();
    await pending;
    expect(isDbWriteActive(db)).toBe(false);
    const result = await withIdempotency(db, scope('busy'), () => ({ ok: true }));
    expect(result).toEqual({ ok: true });
  });
});

function createRaceDb(concurrent: { responseJson: string; status: string }): Database.Database {
  const get = vi.fn()
    .mockReturnValueOnce(undefined)
    .mockReturnValueOnce(concurrent);
  const run = vi.fn(() => {
    throw new Error('race insert failed');
  });
  const prepare = vi.fn((sql: string) => {
    if (sql.startsWith('DELETE FROM IdempotencyRecord')) return { run: vi.fn() };
    if (sql.includes('SELECT responseJson')) return { get };
    if (sql.startsWith('INSERT INTO IdempotencyRecord')) return { run };
    return { run: vi.fn() };
  });
  return { prepare } as unknown as Database.Database;
}
