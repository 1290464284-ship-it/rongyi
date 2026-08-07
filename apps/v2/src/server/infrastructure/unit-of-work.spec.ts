import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from './database';
import { SqliteUnitOfWork } from './unit-of-work';

describe('SqliteUnitOfWork', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-uow-'));
    db = createDatabase(dataDir);
    db.exec('CREATE TABLE IF NOT EXISTS UowTest (id TEXT PRIMARY KEY, value TEXT)');
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('commits successful transactions and rolls back failures', () => {
    const uow = new SqliteUnitOfWork(db);
    uow.run(() => {
      db.prepare('INSERT INTO UowTest (id, value) VALUES (?, ?)').run('u1', 'ok');
    });
    expect(() => uow.run(() => {
      db.prepare('INSERT INTO UowTest (id, value) VALUES (?, ?)').run('u2', 'bad');
      throw new Error('fail');
    })).toThrow('fail');
    const rows = db.prepare('SELECT id FROM UowTest ORDER BY id').all() as Array<{ id: string }>;
    expect(rows).toEqual([{ id: 'u1' }]);
  });
});

