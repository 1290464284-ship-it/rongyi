import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from './database';
import { withIdempotency } from './idempotency';

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

  it('runs the operation once for the same key', () => {
    let calls = 0;
    const first = withIdempotency(db, 'key-1', () => {
      calls += 1;
      return { value: 1 };
    });
    const second = withIdempotency(db, 'key-1', () => {
      calls += 1;
      return { value: 2 };
    });
    expect(first.value).toBe(1);
    expect(second.value).toBe(1);
    expect(calls).toBe(1);
  });

  it('allows retry after the operation throws', () => {
    let calls = 0;
    expect(() => withIdempotency(db, 'key-2', () => {
      calls += 1;
      throw new Error('boom');
    })).toThrow('boom');
    const result = withIdempotency(db, 'key-2', () => {
      calls += 1;
      return { ok: true };
    });
    expect(result.ok).toBe(true);
    expect(calls).toBe(2);
  });

  it('rethrows a failed idempotency record insert', () => {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS idempotency_fail_insert
      AFTER INSERT ON IdempotencyRecord
      WHEN NEW.key = 'race'
      BEGIN
        SELECT RAISE(ABORT, 'race insert failed');
      END
    `);
    expect(() => withIdempotency(db, 'race', () => ({ ok: true })))
      .toThrow('race insert failed');
  });

  it('returns a concurrent result when the idempotency insert races', () => {
    const get = vi.fn()
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce({ responseJson: '{"ok":true}' });
    const run = vi.fn(() => {
      throw new Error('race insert failed');
    });
    const raceDb = {
      prepare: vi.fn(() => ({ get, run })),
    } as unknown as Database.Database;
    expect(withIdempotency(raceDb, 'race-concurrent', () => ({ ok: false }))).toEqual({ ok: true });
    expect(get).toHaveBeenCalledTimes(2);
    expect(run).toHaveBeenCalledOnce();
  });
});
