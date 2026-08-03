import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { importLegacyDatabase } from './legacy-import';
import { Logger } from './logger';

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

  it('reports a corrupt source and a corrupt copied target', () => {
    const corruptSqlite = (filePath: string): void => {
      const data = fs.readFileSync(filePath);
      data[20] ^= 0xff;
      fs.writeFileSync(filePath, data);
    };
    const corruptSource = path.join(dataDir, 'corrupt-source.sqlite');
    const sourceDb = new Database(corruptSource);
    sourceDb.exec('CREATE TABLE Sample (id TEXT PRIMARY KEY)');
    sourceDb.close();
    corruptSqlite(corruptSource);

    const logger = new Logger();
    const errorSpy = vi.spyOn(logger, 'error');
    const corruptResult = importLegacyDatabase(corruptSource, path.join(dataDir, 'corrupt-target.sqlite'), logger);
    expect(corruptResult.imported).toBe(false);
    expect(corruptResult.integrityOk).toBe(false);
    expect(errorSpy).toHaveBeenCalledOnce();

    const validSource = path.join(dataDir, 'valid-source.sqlite');
    const validDb = new Database(validSource);
    validDb.exec('CREATE TABLE Sample (id TEXT PRIMARY KEY)');
    validDb.close();
    const targetPath = path.join(dataDir, 'target-integrity-fail.sqlite');
    const originalCopy = fs.copyFileSync.bind(fs);
    vi.spyOn(fs, 'copyFileSync').mockImplementation(((source: string, target: string) => {
      originalCopy(source, target);
      corruptSqlite(target);
    }) as unknown as typeof fs.copyFileSync);
    expect(() => importLegacyDatabase(validSource, targetPath)).toThrow('imported database integrity check failed');
    vi.restoreAllMocks();
  });
});
