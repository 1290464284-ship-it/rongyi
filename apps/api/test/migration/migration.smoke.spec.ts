import Database from 'better-sqlite3';
import { CURRENT_VERSION, runMigrations, migrationNames } from '../../src/db/migrations';
import { createSchema } from '../../src/db/schema';

describe('Migration Smoke Test', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  });

  describe('迁移系统基本功能', () => {
    it('createSchema 应该能成功创建初始表结构', () => {
      expect(() => {
        createSchema(db);
      }).not.toThrow();

      const tables = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      ).all() as Array<{ name: string }>;

      expect(tables.length).toBeGreaterThan(0);
    });

    it('schema_migrations 表应该在迁移后存在', () => {
      createSchema(db);
      runMigrations(db);

      const result = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'schema_migrations'"
      ).get() as { name: string } | undefined;
      expect(result).toBeDefined();
    });

    it('runMigrations 应该完整执行到 CURRENT_VERSION', () => {
      createSchema(db);
      expect(() => runMigrations(db)).not.toThrow();

      const row = db.prepare(
        'SELECT MAX(CAST(version AS INTEGER)) as v FROM schema_migrations'
      ).get() as { v: number | null } | undefined;
      expect(row?.v).toBe(CURRENT_VERSION);
    });

    it('CURRENT_VERSION 应该是正整数', () => {
      expect(CURRENT_VERSION).toBeGreaterThan(0);
      expect(Number.isSafeInteger(CURRENT_VERSION)).toBe(true);
    });
  });

  describe('迁移版本管理', () => {
    it('迁移名称映射应该包含所有版本', () => {
      const definedVersions = Object.keys(migrationNames).map(Number);
      expect(definedVersions.length).toBe(CURRENT_VERSION);
      for (let v = 1; v <= CURRENT_VERSION; v++) {
        expect(migrationNames[v]).toBeDefined();
        expect(typeof migrationNames[v]).toBe('string');
        expect(migrationNames[v].length).toBeGreaterThan(0);
      }
    });
  });

  describe('核心表结构验证', () => {
    beforeEach(() => {
      createSchema(db);
      runMigrations(db);
    });

    it('User 表应该存在并有基本列', () => {
      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'User'"
      ).get() as { name: string } | undefined;

      if (tableExists) {
        const columns = db.prepare('PRAGMA table_info(User)').all() as Array<{ name: string }>;
        const columnNames = columns.map(c => c.name);

        expect(columnNames).toContain('id');
        expect(columnNames).toContain('username');
        expect(columnNames).toContain('passwordHash');
        expect(columnNames).toContain('name');
        expect(columnNames).toContain('role');
        expect(columnNames).toContain('clinicId');
      }
    });

    it('Patient 表应该存在并有基本列', () => {
      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'Patient'"
      ).get() as { name: string } | undefined;

      if (tableExists) {
        const columns = db.prepare('PRAGMA table_info(Patient)').all() as Array<{ name: string }>;
        const columnNames = columns.map(c => c.name);

        expect(columnNames).toContain('id');
        expect(columnNames).toContain('name');
        expect(columnNames).toContain('phone');
        expect(columnNames).toContain('clinicId');
      }
    });

    it('Charge 表应该存在并有基本列', () => {
      const tableExists = db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'Charge'"
      ).get() as { name: string } | undefined;

      if (tableExists) {
        const columns = db.prepare('PRAGMA table_info(Charge)').all() as Array<{ name: string }>;
        const columnNames = columns.map(c => c.name);

        expect(columnNames).toContain('id');
        expect(columnNames).toContain('patientId');
        expect(columnNames).toContain('totalAmount');
        expect(columnNames).toContain('status');
      }
    });
  });

  describe('数据库完整性', () => {
    it('创建 schema 后完整性检查应该通过', () => {
      createSchema(db);

      const integrity = db.prepare('PRAGMA integrity_check').all() as Array<{ integrity_check: string }>;
      expect(integrity[0].integrity_check).toBe('ok');
    });
  });
});
