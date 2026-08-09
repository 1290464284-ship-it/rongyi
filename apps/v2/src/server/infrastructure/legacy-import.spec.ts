import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { importLegacyDatabase } from './legacy-import';
import { Logger } from './logger';
import type { LegacyImportDecision, V2DbOpener } from '../main';

// --- Mocks so `../main` can be imported in tests without starting a server,
// --- creating real databases, or writing logs into the repository.
// The legacy-import module itself is intentionally left real: the existing
// tests below exercise `importLegacyDatabase` against actual sqlite files.
vi.mock('../http/app', () => ({
  createApp: vi.fn(() => ({
    listen: vi.fn(() => ({ on: vi.fn() })),
  })),
}));
vi.mock('./database', () => ({
  createDatabase: vi.fn(() => ({
    pragma: vi.fn(),
    close: vi.fn(),
    prepare: vi.fn(() => ({ get: vi.fn(() => undefined), all: vi.fn(() => []) })),
  })),
  seedDatabase: vi.fn(),
  createPerformanceIndexes: vi.fn(),
  syncLegacySchema: vi.fn(),
}));
vi.mock('./idempotency', () => ({
  cleanupIdempotencyRecords: vi.fn(() => 0),
}));
vi.mock('./migrations', () => ({
  runMigrations: vi.fn(),
}));
vi.mock('./search-index', () => ({
  rebuildSearchIndex: vi.fn(),
}));
vi.mock('./restore-apply', () => ({
  applyStagedRestore: vi.fn(),
}));
vi.mock('../application/services', () => ({
  BackupService: class {
    create(): { ok: boolean } {
      return { ok: true };
    }
    cleanup(): Record<string, never> {
      return {};
    }
  },
  AuditService: class {
    cleanup(): number {
      return 0;
    }
  },
  AlertService: class {
    create(): void {
      /* no-op */
    }
  },
}));

vi.mock('./sqlite-files', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sqlite-files')>();
  return {
    ...actual,
    backupSqliteFile: vi.fn((source: string, backup: string) => {
      if (process.env.V2_CORRUPT_LEGACY_BACKUP === '1') {
        const temp = `${backup}.tmp`;
        actual.backupSqliteFile(source, temp);
        const data = fs.readFileSync(temp);
        data[20] ^= 0xff;
        fs.writeFileSync(backup, data);
        fs.unlinkSync(temp);
        return;
      }
      return actual.backupSqliteFile(source, backup);
    }),
  };
});

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
    process.env.V2_CORRUPT_LEGACY_BACKUP = '1';
    expect(() => importLegacyDatabase(validSource, targetPath)).toThrow('imported database integrity check failed');
    delete process.env.V2_CORRUPT_LEGACY_BACKUP;
  });

  it('rejects a legacy database with CHECK constraint violations', () => {
    const dirtySource = path.join(dataDir, 'dirty-source.sqlite');
    const dirtyDb = new Database(dirtySource);
    dirtyDb.exec('CREATE TABLE MemberCard (id TEXT PRIMARY KEY, balance INTEGER NOT NULL CHECK (balance >= 0))');
    dirtyDb.pragma('ignore_check_constraints = ON');
    dirtyDb.prepare('INSERT INTO MemberCard (id, balance) VALUES (?, ?)').run('m1', -100);
    dirtyDb.close();
    expect(() => importLegacyDatabase(dirtySource, path.join(dataDir, 'dirty-target.sqlite')))
      .toThrow('imported database integrity check failed');
  });
});

describe('shouldImportLegacyDb (T2R-15 / R2-P1-12)', () => {
  let decisionDir: string;
  let shouldImportLegacyDb: (
    v2DbPath: string,
    options?: { openDb?: V2DbOpener },
  ) => LegacyImportDecision;

  beforeAll(async () => {
    decisionDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-legacy-decision-'));
    // Isolate every directory main.ts reads/writes at module evaluation:
    // data dir, log dir, and point the legacy db at a missing path so the
    // startup import block is skipped while we test the decision in isolation.
    process.env.V2_DATA_DIR = decisionDir;
    process.env.V2_LOG_DIR = path.join(decisionDir, 'logs');
    process.env.V2_LEGACY_DB_PATH = path.join(decisionDir, 'no-legacy.sqlite');
    delete process.env.V2_DB_PATH;
    ({ shouldImportLegacyDb } = await import('../main'));
  });

  afterAll(() => {
    delete process.env.V2_DATA_DIR;
    delete process.env.V2_LOG_DIR;
    delete process.env.V2_LEGACY_DB_PATH;
    fs.rmSync(decisionDir, { recursive: true, force: true });
  });

  it('imports when v2.sqlite does not exist', () => {
    const missing = path.join(decisionDir, 'missing-v2.sqlite');
    const decision = shouldImportLegacyDb(missing);
    expect(decision.shouldImport).toBe(true);
    expect(decision.promptRestore).toBe(false);
    expect(decision.v2IntegrityOk).toBeUndefined();
  });

  it('does not import when v2.sqlite exists and passes quick_check, even if smaller than 64KB', () => {
    const v2Path = path.join(decisionDir, 'ok-v2.sqlite');
    const db = new Database(v2Path);
    db.exec('CREATE TABLE Patient (id TEXT PRIMARY KEY, name TEXT)');
    db.close();
    // Regression for R2-P1-12: a healthy but small v2.sqlite used to be
    // mistaken for an empty database by the `size < 64 * 1024` heuristic.
    expect(fs.statSync(v2Path).size).toBeLessThan(64 * 1024);
    const decision = shouldImportLegacyDb(v2Path);
    expect(decision.shouldImport).toBe(false);
    expect(decision.promptRestore).toBe(false);
    expect(decision.v2IntegrityOk).toBe(true);
  });

  it('prompts restore/re-import when v2.sqlite exists but fails quick_check', () => {
    const v2Path = path.join(decisionDir, 'corrupt-v2.sqlite');
    const db = new Database(v2Path);
    db.exec('CREATE TABLE Patient (id TEXT PRIMARY KEY, name TEXT)');
    db.close();
    const data = fs.readFileSync(v2Path);
    data[20] ^= 0xff; // corrupt the database header (same technique as above)
    fs.writeFileSync(v2Path, data);
    const decision = shouldImportLegacyDb(v2Path);
    expect(decision.shouldImport).toBe(false);
    expect(decision.promptRestore).toBe(true);
    expect(decision.v2IntegrityOk).toBe(false);
  });

  it('prompts restore/re-import when the v2 file cannot be opened as a database', () => {
    const notADb = path.join(decisionDir, 'not-a-db.sqlite');
    fs.writeFileSync(notADb, 'this is definitely not a sqlite database file');
    const decision = shouldImportLegacyDb(notADb);
    expect(decision.shouldImport).toBe(false);
    expect(decision.promptRestore).toBe(true);
    expect(decision.v2IntegrityOk).toBe(false);
  });

  it('uses the injected db opener for the quick_check', () => {
    const v2Path = path.join(decisionDir, 'injected-v2.sqlite');
    const db = new Database(v2Path);
    db.exec('CREATE TABLE T (id INTEGER PRIMARY KEY)');
    db.close();
    const openDb = vi.fn((filePath: string) => {
      const opened = new Database(filePath, { readonly: true });
      return {
        pragma: (source: string) => opened.pragma(source),
        close: () => opened.close(),
      };
    });
    const decision = shouldImportLegacyDb(v2Path, { openDb });
    expect(openDb).toHaveBeenCalledWith(v2Path);
    expect(decision.shouldImport).toBe(false);
    expect(decision.promptRestore).toBe(false);
    expect(decision.v2IntegrityOk).toBe(true);
  });
});
