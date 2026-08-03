import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from './database';
import { listAllResources, resolveResource } from './legacy-registry';

describe('legacy resource registry', () => {
  let db: Database.Database;
  let dataDir: string;
  const table = 'CephalometricAnalysisRecord';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-legacy-registry-'));
    db = createDatabase(dataDir);
    db.exec(`
      CREATE TABLE ${table} (
        id TEXT PRIMARY KEY,
        payload BLOB,
        createdAt TEXT,
        updatedAt TEXT,
        deletedAt TEXT
      )
    `);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('builds, caches, and lists dynamic legacy definitions', () => {
    const first = resolveResource(db, table);
    expect(first).toBeDefined();
    expect(first?.fields.some((field) => field.name === 'payload')).toBe(true);
    expect(resolveResource(db, table)).toBe(first);

    const all = listAllResources(db);
    expect(all.some((definition) => definition.name === table)).toBe(true);
    const allAgain = listAllResources(db);
    expect(allAgain.some((definition) => definition.name === table)).toBe(true);
  });
});
