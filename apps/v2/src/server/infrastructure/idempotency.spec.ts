import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from './database';
import { withIdempotency, type IdempotencyScope } from './idempotency';

const scope = (requestId: string, overrides: Partial<IdempotencyScope> = {}): IdempotencyScope => ({
  operation: 'charge.pay',
  userId: 'user-1',
  clinicId: 'clinic-1',
  requestId,
  ...overrides,
});

function scopeKey(input: IdempotencyScope): string {
  return createHash('sha256')
    .update([input.operation, input.userId ?? '', input.clinicId ?? '', input.requestId].join('\0'))
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

  it('supports async operations and removes failed processing records', async () => {
    let calls = 0;
    await expect(withIdempotency(db, scope('async-fail'), async () => {
      calls += 1;
      throw new Error('async boom');
    })).rejects.toThrow('async boom');
    const result = await withIdempotency(db, scope('async-fail'), async () => {
      calls += 1;
      return { ok: true };
    });
    const replay = await withIdempotency(db, scope('async-fail'), async () => {
      calls += 1;
      return { ok: false };
    });
    expect(result.ok).toBe(true);
    expect(replay.ok).toBe(true);
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

  it('retries processing records that exceed the recovery timeout', async () => {
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
    const result = await withIdempotency(db, scope('stale-processing'), () => {
      calls += 1;
      return { ok: true };
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(1);
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
    const failingDb = { prepare } as unknown as Database.Database;
    expect(() => withIdempotency(failingDb, scope('update-failure'), () => ({ ok: true })))
      .toThrow('update failed');
    expect(deleteRun).toHaveBeenCalledTimes(3);
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
