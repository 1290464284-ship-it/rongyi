import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importLegacyDatabase } from './legacy-import';

describe('importLegacyDatabase', () => {
  let dataDir: string;
  let sourcePath: string;
  let targetPath: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-legacy-'));
    sourcePath = path.join(dataDir, 'source.sqlite');
    targetPath = path.join(dataDir, 'target.sqlite');
    const db = new Database(sourcePath);
    db.exec('CREATE TABLE Patient (id TEXT PRIMARY KEY, name TEXT)');
    db.prepare('INSERT INTO Patient (id, name) VALUES (?, ?)').run('p1', 'Legacy Patient');
    db.close();
  });

  afterAll(() => {
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('imports a valid legacy database without modifying the source', () => {
    const result = importLegacyDatabase(sourcePath, targetPath);
    expect(result.imported).toBe(true);
    expect(result.integrityOk).toBe(true);
    const target = new Database(targetPath, { readonly: true });
    const row = target.prepare('SELECT name FROM Patient WHERE id = ?').get('p1') as { name: string };
    expect(row.name).toBe('Legacy Patient');
    target.close();
    const source = new Database(sourcePath, { readonly: true });
    expect(source.prepare('SELECT COUNT(*) AS c FROM Patient').get()).toEqual({ c: 1 });
    source.close();
  });

  it('reports a missing source without creating a target', () => {
    const missing = path.join(dataDir, 'missing.sqlite');
    const target = path.join(dataDir, 'missing-target.sqlite');
    const result = importLegacyDatabase(missing, target);
    expect(result.imported).toBe(false);
    expect(result.sourceExists).toBe(false);
    expect(fs.existsSync(target)).toBe(false);
  });
});
