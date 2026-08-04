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

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-legacy-registry-'));
    db = createDatabase(dataDir);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('resolves generated explicit legacy resources and rejects dynamic table names', () => {
    expect(resolveResource(db, 'printTemplates')).toBeDefined();
    expect(resolveResource(db, 'User')).toBeUndefined();
    expect(resolveResource(db, 'cephalometricAnalysisRecord')).toBeDefined();

    const all = listAllResources(db);
    expect(all.some((definition) => definition.name === 'printTemplates')).toBe(true);
    expect(all.some((definition) => definition.name === 'User')).toBe(false);
  });
});
