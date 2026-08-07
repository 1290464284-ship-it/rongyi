import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { createDatabase, seedDatabase, syncLegacySchema, uniqueIndexColumns } from './database';

describe('database bootstrap', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-db-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
  });

  afterAll(async () => {
    db.close();
    // Windows 上 better-sqlite3 关闭后 WAL 句柄可能延迟释放，重试避免 EPERM
    for (let attempt = 0; attempt < 12; attempt += 1) {
      try {
        fs.rmSync(dataDir, { recursive: true, force: true });
        return;
      } catch (error) {
        if (attempt === 11) throw error;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  });

  it('creates core tables and seeds an admin user', () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    expect(tables.some((table) => table.name === 'Patient')).toBe(true);
    expect(tables.some((table) => table.name === 'Charge')).toBe(true);
    const admin = db.prepare("SELECT username FROM User WHERE username = 'admin'").get() as { username: string } | undefined;
    expect(admin?.username).toBe('admin');
  });

  it('is idempotent when seed runs again', () => {
    seedDatabase(db);
    const count = (db.prepare("SELECT COUNT(*) AS c FROM User WHERE username = 'admin'").get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it('synchronizes legacy schema tables from the existing schema files', () => {
    const schemaDir = path.resolve(import.meta.dirname, '..', '..', '..', 'legacy', 'schema');
    syncLegacySchema(db, schemaDir);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    expect(tables.some((table) => table.name === 'PrintTemplate')).toBe(true);
  });

  it('is safe when the legacy schema directory is missing', () => {
    expect(() => syncLegacySchema(db, path.join(os.tmpdir(), 'missing-v2-schema'))).not.toThrow();
  });

  it('tolerates malformed legacy schema statements', () => {
    const malformedDir = path.join(dataDir, 'malformed-schema');
    fs.mkdirSync(malformedDir, { recursive: true });
    fs.writeFileSync(path.join(malformedDir, 'no-paren.tables.ts'), 'CREATE TABLE IF NOT EXISTS MissingParen');
    fs.writeFileSync(path.join(malformedDir, 'no-close.tables.ts'), 'CREATE TABLE IF NOT EXISTS MissingClose (id TEXT');
    expect(() => syncLegacySchema(db, malformedDir)).not.toThrow();
  });

  it('skips legacy schema tables that are not registered', () => {
    const filteredDir = path.join(dataDir, 'filtered-schema');
    fs.mkdirSync(filteredDir, { recursive: true });
    fs.writeFileSync(
      path.join(filteredDir, 'filtered.tables.ts'),
      'CREATE TABLE IF NOT EXISTS Patient (id TEXT); CREATE TABLE IF NOT EXISTS UnregisteredDeadTable (id TEXT);',
    );
    syncLegacySchema(db, filteredDir);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as Array<{ name: string }>;
    expect(tables.some((table) => table.name === 'Patient')).toBe(true);
    expect(tables.some((table) => table.name === 'UnregisteredDeadTable')).toBe(false);
  });

  it('creates unique indexes without clinicId when a legacy table lacks the column', () => {
    const legacyDir = path.join(dataDir, 'legacy-no-clinic');
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacyPath = path.join(legacyDir, 'v2.sqlite');
    const legacy = new Database(legacyPath);
    legacy.exec('CREATE TABLE Patient (id TEXT PRIMARY KEY, code TEXT, deletedAt TEXT)');
    legacy.close();
    const db = createDatabase(legacyDir, legacyPath);
    const index = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'idx_v2_unique_patients_code'").get() as
      | { sql: string }
      | undefined;
    expect(index?.sql ?? '').not.toContain('clinicId');
    db.close();
  });

  it('builds unique index columns for both clinic-scoped and legacy tables', () => {
    const helperDir = path.join(dataDir, 'unique-helper');
    fs.mkdirSync(helperDir, { recursive: true });
    const helperPath = path.join(helperDir, 'v2.sqlite');
    const helper = new Database(helperPath);
    helper.exec('CREATE TABLE LegacyNoClinic (id TEXT PRIMARY KEY, code TEXT)');
    helper.exec('CREATE TABLE ClinicTable (id TEXT PRIMARY KEY, clinicId TEXT, code TEXT)');
    expect(uniqueIndexColumns(helper, 'LegacyNoClinic', 'code')).toBe('code');
    expect(uniqueIndexColumns(helper, 'ClinicTable', 'code')).toBe('clinicId, code');
    helper.close();
  });

  it('honors the configured data directory default and production seed guard', () => {
    const envDataDir = path.join(dataDir, 'env-data');
    process.env.V2_DATA_DIR = envDataDir;
    const envDb = createDatabase();
    expect(fs.existsSync(path.join(envDataDir, 'v2.sqlite'))).toBe(true);
    envDb.close();
    delete process.env.V2_DATA_DIR;

    const oldCwd = process.cwd();
    const cwdDataDir = path.join(dataDir, 'cwd-data');
    fs.mkdirSync(cwdDataDir, { recursive: true });
    process.chdir(cwdDataDir);
    const cwdDb = createDatabase();
    expect(fs.existsSync(path.join(cwdDataDir, 'data', 'v2.sqlite'))).toBe(true);
    cwdDb.close();
    process.chdir(oldCwd);

    const productionDir = path.join(dataDir, 'production-data');
    process.env.NODE_ENV = 'production';
    const productionDb = createDatabase(productionDir);
    expect(() => seedDatabase(productionDb)).toThrow('refusing to seed default credentials');
    productionDb.close();

    const existingAdminDir = path.join(dataDir, 'production-existing-admin');
    const existingAdminDb = createDatabase(existingAdminDir);
    const now = new Date().toISOString();
    existingAdminDb.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES ('user-prod-admin', 'clinic-v2-001', ?, ?, NULL, 'admin', 'existing-hash', 'Admin', 'BOSS', 1, 0, 0)`,
    ).run(now, now);
    seedDatabase(existingAdminDb);
    const existingCount = (existingAdminDb.prepare("SELECT COUNT(*) AS c FROM User WHERE username = 'admin'").get() as { c: number }).c;
    expect(existingCount).toBe(1);
    existingAdminDb.close();
    delete process.env.NODE_ENV;
  });

  it('never resets an existing admin password, even with dev seed flags (S-M4)', () => {
    const dir = path.join(dataDir, 'dev-seed-gate');
    const gateDb = createDatabase(dir);
    const now = new Date().toISOString();
    gateDb.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES ('user-gate-admin', 'clinic-v2-001', ?, ?, NULL, 'admin', 'custom-hash', 'Admin', 'BOSS', 1, 0, 0)`,
    ).run(now, now);
    const prevNodeEnv = process.env.NODE_ENV;
    const prevSeed = process.env.V2_ALLOW_DEV_SEED;
    const prevPassword = process.env.V2_ADMIN_PASSWORD;
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      // development 且显式授权（旧版 V2_ALLOW_DEV_SEED=1 曾重置密码）：现在一律不重置
      process.env.NODE_ENV = 'development';
      process.env.V2_ALLOW_DEV_SEED = '1';
      delete process.env.V2_ADMIN_PASSWORD;
      seedDatabase(gateDb);
      const unchanged = (gateDb.prepare("SELECT passwordHash FROM User WHERE username = 'admin'").get() as { passwordHash: string }).passwordHash;
      expect(unchanged).toBe('custom-hash');
      // 未配置 V2_ADMIN_PASSWORD 时应给出默认口令告警
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
      if (prevNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = prevNodeEnv;
      if (prevSeed === undefined) delete process.env.V2_ALLOW_DEV_SEED; else process.env.V2_ALLOW_DEV_SEED = prevSeed;
      if (prevPassword === undefined) delete process.env.V2_ADMIN_PASSWORD; else process.env.V2_ADMIN_PASSWORD = prevPassword;
      gateDb.close();
    }
  });

  it('passes the default quick_check on a healthy database', () => {
    const quickDir = path.join(dataDir, 'quick-check');
    fs.mkdirSync(quickDir, { recursive: true });
    const quickDb = createDatabase(quickDir);
    expect(quickDb.pragma('quick_check')).toEqual([{ quick_check: 'ok' }]);
    quickDb.close();
  });

  it('passes the full integrity check on a healthy database', () => {
    const fullDir = path.join(dataDir, 'full-check');
    fs.mkdirSync(fullDir, { recursive: true });
    const fullDb = createDatabase(fullDir, undefined, { fullIntegrityCheck: true });
    expect(fullDb.pragma('integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    fullDb.close();
  });

  it('full integrity check rejects a database file corrupted with garbage bytes', () => {
    const corruptDir = path.join(dataDir, 'corrupt-full-check');
    fs.mkdirSync(corruptDir, { recursive: true });
    const corruptPath = path.join(corruptDir, 'v2.sqlite');
    const base = createDatabase(corruptDir, corruptPath);
    base.pragma('wal_checkpoint(TRUNCATE)');
    base.close();

    const pageSize = 4096;
    const fileSize = fs.statSync(corruptPath).size;
    const alignedMiddle = Math.floor(fileSize / 2 / pageSize) * pageSize;
    const corruptOffset = Math.max(pageSize, alignedMiddle);
    const fd = fs.openSync(corruptPath, 'r+');
    try {
      fs.writeSync(fd, Buffer.alloc(pageSize, 0xab), 0, pageSize, corruptOffset);
    } finally {
      fs.closeSync(fd);
    }

    expect(() => createDatabase(corruptDir, corruptPath, { fullIntegrityCheck: true })).toThrow(
      /SQLite integrity check failed|database disk image is malformed/,
    );
  });
});
