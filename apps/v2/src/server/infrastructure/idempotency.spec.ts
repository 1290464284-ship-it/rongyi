import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
});

