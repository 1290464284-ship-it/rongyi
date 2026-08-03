import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, syncLegacySchema } from './database';
import { migrations, runMigrations } from './migrations';

describe('migrations', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-'));
    db = createDatabase(dataDir);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('applies pending migrations once and records versions', () => {
    runMigrations(db);
    runMigrations(db);
    const rows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as Array<{
      version: number;
      name: string;
    }>;
    expect(rows.map((row) => ({ version: Number(row.version), name: row.name }))).toEqual(
      migrations.map((migration) => ({ version: migration.version, name: migration.name })),
    );
  });
});
