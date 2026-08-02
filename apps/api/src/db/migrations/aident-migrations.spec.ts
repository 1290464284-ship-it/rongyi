import Database from 'better-sqlite3';
import { CURRENT_VERSION } from './index';
import { migrateToV31 } from './v31';
import { migrateToV32 } from './v32';
import {
  setMigrationDb,
  ensureMigrationTable,
  setVersion,
} from './helpers';
import { systemTables } from '../schema/system.tables';
import { patientTables } from '../schema/patient.tables';
import { clinicalTables } from '../schema/clinical.tables';
import { financialTables } from '../schema/financial.tables';
import { pharmacyTables } from '../schema/pharmacy.tables';
import { inventoryTables } from '../schema/inventory.tables';
import { wechatTables } from '../schema/wechat.tables';
import { SettingsService } from '../../modules/system/settings/settings.service';
import { DbService } from '../db.service';
import { CacheService } from '../../common/services/cache.service';
import { ClinicContextService } from '../../common/services/clinic-context.service';
import { AppLogger } from '../../common/services/logger.service';
import { AuditLogService } from '../../common/services/audit-log.service';

type DbInstance = InstanceType<typeof Database>;

const ALL_TABLE_SCHEMAS = [
  ...systemTables,
  ...patientTables,
  ...clinicalTables,
  ...financialTables,
  ...pharmacyTables,
  ...inventoryTables,
  ...wechatTables,
];

const NEW_TABLES = [
  'CephalometricLandmarkSet',
  'CephalometricAnalysisRecord',
  'CephalometricNormValue',
  'DrugContraindication',
  'PatientRiskScore',
  'BusinessAlert',
  'InventoryReplenishmentSuggestion',
  'SatisfactionSurvey',
  'StaffSchedule',
  'StaffLeaveRequest',
  'DataImportJob',
];

const BASE_TABLES_FOR_MIGRATION = [
  'Clinic',
  'Patient',
  'User',
  'Visit',
  'MedicalRecordPhrase',
  'Imaging',
  'DrugCatalog',
  'InventoryItem',
  'ClinicInfo',
];

const NEW_SETTINGS_KEYS = [
  'aiMedicalSummaryEnabled',
  'aiContraindicationEnabled',
  'aiRiskScoreEnabled',
  'aiRecareEnabled',
  'aiChargeSuggestEnabled',
  'aiBusinessAlertEnabled',
  'aiInventoryReplenishEnabled',
  'aiRfmEnabled',
  'aiChurnEnabled',
  'aiDoctorPerfAnomalyEnabled',
  'aiCephalometricsEnabled',
  'aiProgressBoardEnabled',
  'aiSatisfactionEnabled',
  'aiSchedulingEnabled',
  'aiImportToolEnabled',
  'aiDbEncryptionEnabled',
  'electronCloseToTray',
];

function createEmptyDbForMigration(): DbInstance {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.pragma('foreign_keys = ON');

  for (const tableName of BASE_TABLES_FOR_MIGRATION) {
    switch (tableName) {
      case 'Clinic':
        db.exec(`CREATE TABLE IF NOT EXISTS Clinic (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          code TEXT UNIQUE NOT NULL,
          isActive INTEGER DEFAULT 1,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT
        )`);
        break;
      case 'User':
        db.exec(`CREATE TABLE IF NOT EXISTS User (
          id TEXT PRIMARY KEY,
          username TEXT NOT NULL,
          passwordHash TEXT NOT NULL,
          name TEXT NOT NULL,
          role TEXT DEFAULT 'RECEPTIONIST',
          phone TEXT,
          active INTEGER DEFAULT 1,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          UNIQUE(clinicId, username)
        )`);
        break;
      case 'Patient':
        db.exec(`CREATE TABLE IF NOT EXISTS Patient (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          gender TEXT NOT NULL,
          phone TEXT NOT NULL,
          clinicId TEXT NOT NULL,
          active INTEGER DEFAULT 1,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          UNIQUE(clinicId, code)
        )`);
        break;
      case 'Visit':
        db.exec(`CREATE TABLE IF NOT EXISTS Visit (
          id TEXT PRIMARY KEY,
          patientId TEXT NOT NULL,
          appointmentId TEXT UNIQUE,
          doctorId TEXT NOT NULL,
          chiefComplaint TEXT,
          diagnosis TEXT,
          treatmentPlan TEXT,
          startTime TEXT DEFAULT CURRENT_TIMESTAMP,
          endTime TEXT,
          status TEXT DEFAULT 'IN_PROGRESS',
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT
        )`);
        break;
      case 'MedicalRecordPhrase':
        db.exec(`CREATE TABLE IF NOT EXISTS MedicalRecordPhrase (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT,
          content TEXT NOT NULL,
          isPublic INTEGER DEFAULT 1,
          creatorId TEXT,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP
        )`);
        break;
      case 'Imaging':
        db.exec(`CREATE TABLE IF NOT EXISTS Imaging (
          id TEXT PRIMARY KEY,
          patientId TEXT NOT NULL,
          visitId TEXT,
          doctorId TEXT,
          type TEXT NOT NULL,
          title TEXT NOT NULL,
          imageUrl TEXT NOT NULL,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT
        )`);
        break;
      case 'DrugCatalog':
        db.exec(`CREATE TABLE IF NOT EXISTS DrugCatalog (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          spec TEXT NOT NULL,
          category TEXT NOT NULL,
          price REAL NOT NULL,
          unit TEXT NOT NULL,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(clinicId, code)
        )`);
        break;
      case 'InventoryItem':
        db.exec(`CREATE TABLE IF NOT EXISTS InventoryItem (
          id TEXT PRIMARY KEY,
          code TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          unit TEXT NOT NULL,
          stock REAL DEFAULT 0,
          clinicId TEXT NOT NULL,
          createdAt TEXT DEFAULT CURRENT_TIMESTAMP,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          deletedAt TEXT,
          UNIQUE(clinicId, code)
        )`);
        break;
      case 'ClinicInfo':
        db.exec(`CREATE TABLE IF NOT EXISTS ClinicInfo (
          id TEXT PRIMARY KEY,
          key TEXT NOT NULL,
          value TEXT,
          clinicId TEXT,
          updatedAt TEXT DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(clinicId, key)
        )`);
        break;
    }
  }

  return db;
}

function createFullSchemaDb(): DbInstance {
  const db = new Database(':memory:');
  db.pragma('journal_mode = MEMORY');
  db.pragma('foreign_keys = ON');

  for (const sql of ALL_TABLE_SCHEMAS) {
    db.exec(sql);
  }

  return db;
}

function createDbServiceFor(db: DbInstance): DbService {
  const service = new DbService();
  (service as unknown as { database: DbInstance }).database = db;
  (service as unknown as { statementCache: Map<string, unknown> }).statementCache = new Map();
  service.onModuleInit = async (): Promise<void> => {
    // 已手动初始化
  };
  return service;
}

describe('艾登特 Task1 数据库迁移验证', () => {
  let migrationDb: DbInstance;
  let fullSchemaDb: DbInstance;

  beforeEach(() => {
    migrationDb = createEmptyDbForMigration();
    fullSchemaDb = createFullSchemaDb();
    setMigrationDb(migrationDb);
    ensureMigrationTable();
  });

  afterEach(() => {
    try { migrationDb.close(); } catch { /* noop */ }
    try { fullSchemaDb.close(); } catch { /* noop */ }
    setMigrationDb(null as unknown as DbInstance);
  });

  describe('TR-1.3: CURRENT_VERSION 和迁移注册', () => {
    it('CURRENT_VERSION 应该等于 49', () => {
      expect(CURRENT_VERSION).toBe(49);
    });

    it('migrationNames 应该包含 v31 和 v32', () => {
      const migrationIndexPath = require.resolve('./index');
      const fs = require('node:fs');
      const content = fs.readFileSync(migrationIndexPath, 'utf-8');
      expect(content).toContain("migrateToV31");
      expect(content).toContain("migrateToV32");
      expect(content).toContain("31: 'aident-12-new-tables'");
      expect(content).toContain("32: 'aident-visit-phrase-columns'");
      expect(content).toContain('case 31: migrateToV31()');
      expect(content).toContain('case 32: migrateToV32()');
    });
  });

  describe('TR-1.1 + TR-1.2: 通过 Schema 定义验证 12 张新表 + 修改列', () => {
    it('schema 定义中 12 张新表应该存在且有 deletedAt 列', () => {
      for (const tableName of NEW_TABLES) {
        const tables = fullSchemaDb.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
        ).get(tableName);
        expect(tables).toBeTruthy();

        const columns = fullSchemaDb.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
        const columnNames = columns.map(c => c.name);

        expect(columnNames).toContain('id');
        expect(columnNames).toContain('clinicId');
        expect(columnNames).toContain('createdAt');
        expect(columnNames).toContain('updatedAt');
        expect(columnNames).toContain('deletedAt');

        const idCol = columns.find(c => c.name === 'id')!;
        expect(idCol.type).toBe('TEXT');

        const clinicIdCol = columns.find(c => c.name === 'clinicId')!;
        expect(clinicIdCol.type).toBe('TEXT');
        expect(clinicIdCol.notnull).toBe(1);
      }
    });

    it('Visit 表应该有 nextReminder 和 summaryAutoGenerated 列', () => {
      const columns = fullSchemaDb.prepare('PRAGMA table_info(Visit)').all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('nextReminder');
      expect(columnNames).toContain('summaryAutoGenerated');

      const nextReminderCol = columns.find(c => c.name === 'nextReminder')!;
      expect(nextReminderCol.type).toBe('TEXT');

      const summaryCol = columns.find(c => c.name === 'summaryAutoGenerated')!;
      expect(summaryCol.type).toMatch(/INTEGER|INT/i);
    });

    it('MedicalRecordPhrase 表应该有 ownerId 和 pinOrder 列', () => {
      const columns = fullSchemaDb.prepare('PRAGMA table_info(MedicalRecordPhrase)').all() as Array<{ name: string; type: string; notnull: number; dflt_value: string | null }>;
      const columnNames = columns.map(c => c.name);

      expect(columnNames).toContain('ownerId');
      expect(columnNames).toContain('pinOrder');

      const ownerIdCol = columns.find(c => c.name === 'ownerId')!;
      expect(ownerIdCol.type).toBe('TEXT');

      const pinOrderCol = columns.find(c => c.name === 'pinOrder')!;
      expect(pinOrderCol.type).toMatch(/INTEGER|INT/i);
    });

    it('所有 12 张新表的 deletedAt 列存在（TR-1.2 针对 schema）', () => {
      for (const tableName of NEW_TABLES) {
        const columns = fullSchemaDb.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
        const deletedAtCol = columns.find(c => c.name === 'deletedAt');
        expect(deletedAtCol).toBeDefined();
      }
    });
  });

  describe('增量迁移执行验证（v31 + v32）', () => {
    it('v31 迁移应该能成功创建 12 张新表', () => {
      expect(() => migrateToV31()).not.toThrow();

      for (const tableName of NEW_TABLES) {
        const row = migrationDb.prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
        ).get(tableName);
        expect(row).toBeTruthy();

        const columns = migrationDb.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>;
        const columnNames = columns.map(c => c.name);
        expect(columnNames).toContain('deletedAt');
        expect(columnNames).toContain('clinicId');
      }

      setVersion(31);
      const version = (migrationDb.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      expect(version).toBe(31);
    });

    it('v32 迁移应该能成功为 Visit 和 MedicalRecordPhrase 加列', () => {
      migrateToV31();
      expect(() => migrateToV32()).not.toThrow();

      const visitCols = migrationDb.prepare('PRAGMA table_info(Visit)').all() as Array<{ name: string }>;
      const visitColNames = visitCols.map(c => c.name);
      expect(visitColNames).toContain('nextReminder');
      expect(visitColNames).toContain('summaryAutoGenerated');

      const phraseCols = migrationDb.prepare('PRAGMA table_info(MedicalRecordPhrase)').all() as Array<{ name: string }>;
      const phraseColNames = phraseCols.map(c => c.name);
      expect(phraseColNames).toContain('ownerId');
      expect(phraseColNames).toContain('pinOrder');

      setVersion(32);
      const version = (migrationDb.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
      expect(version).toBe(32);
    });

    it('增量迁移应该幂等（重复执行 v31/v32 不报错）', () => {
      expect(() => migrateToV31()).not.toThrow();
      expect(() => migrateToV31()).not.toThrow();
      expect(() => migrateToV32()).not.toThrow();
      expect(() => migrateToV32()).not.toThrow();
    });
  });

  describe('TR-1.4: Settings 默认配置验证', () => {
    it('SettingsService 的 DEFAULT_CONFIG 应该包含所有新键且值类型正确', () => {
      const settingsPath = require.resolve('../../modules/system/settings/settings.service');
      const fs = require('node:fs');
      const content = fs.readFileSync(settingsPath, 'utf-8');

      const trueDefaultKeys = NEW_SETTINGS_KEYS.filter(k =>
        k !== 'aiCephalometricsEnabled' && k !== 'aiSchedulingEnabled' && k !== 'aiDbEncryptionEnabled'
      );
      const falseDefaultKeys = ['aiCephalometricsEnabled', 'aiSchedulingEnabled', 'aiDbEncryptionEnabled'];

      for (const key of trueDefaultKeys) {
        expect(content).toContain(`${key}: "true"`);
      }
      for (const key of falseDefaultKeys) {
        expect(content).toContain(`${key}: "false"`);
      }
      expect(content).toContain('electronCloseToTray: "true"');
    });

    it('SystemConfig interface 应该包含所有新键', () => {
      const settingsPath = require.resolve('../../modules/system/settings/settings.service');
      const fs = require('node:fs');
      const content = fs.readFileSync(settingsPath, 'utf-8');

      for (const key of NEW_SETTINGS_KEYS) {
        expect(content).toContain(`${key}: string`);
      }
    });

    it('SettingsService.ensureDefaultConfigs 应该为 ClinicInfo 插入新配置键', () => {
      const db = createFullSchemaDb();
      const dbService = createDbServiceFor(db);

      const cacheService = {
        get: jest.fn().mockResolvedValue(undefined),
        set: jest.fn().mockResolvedValue(undefined),
        del: jest.fn().mockResolvedValue(undefined),
        delPattern: jest.fn().mockResolvedValue(undefined),
      } as unknown as CacheService;

      let clinicContextValue: { clinicId: string | null } = { clinicId: null };
      const clinicContextService = {
        getClinicId: jest.fn(() => clinicContextValue.clinicId),
        run: jest.fn((ctx: unknown, fn: () => unknown) => {
          const prev = clinicContextValue;
          clinicContextValue = ctx as { clinicId: string | null };
          try { return fn(); } finally { clinicContextValue = prev; }
        }),
      } as unknown as ClinicContextService;

      const appLogger = {
        log: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
        debug: jest.fn(),
      } as unknown as AppLogger;

      const auditLogService = {
        logAudit: jest.fn(),
      } as unknown as AuditLogService;

      const settingsService = new SettingsService(
        dbService,
        cacheService,
        clinicContextService,
        auditLogService,
      );
      (settingsService as unknown as { logger: unknown }).logger = appLogger;

      expect(() => settingsService.onModuleInit()).not.toThrow();

      const rows = db.prepare(
        'SELECT key, value FROM ClinicInfo WHERE clinicId IS NULL'
      ).all() as Array<{ key: string; value: string }>;
      const configMap: Record<string, string> = {};
      for (const row of rows) {
        configMap[row.key] = row.value;
      }

      for (const key of NEW_SETTINGS_KEYS) {
        expect(configMap).toHaveProperty(key);
      }

      expect(configMap['aiMedicalSummaryEnabled']).toBe('true');
      expect(configMap['aiCephalometricsEnabled']).toBe('false');
      expect(configMap['aiSchedulingEnabled']).toBe('false');
      expect(configMap['aiDbEncryptionEnabled']).toBe('false');
      expect(configMap['electronCloseToTray']).toBe('true');

      try { db.close(); } catch { /* noop */ }
    });
  });

  describe('12 张新表的字段级验证', () => {
    beforeEach(() => {
      migrateToV31();
      migrateToV32();
    });

    it('CephalometricLandmarkSet 字段正确', () => {
      const cols = migrationDb.prepare('PRAGMA table_info(CephalometricLandmarkSet)').all() as Array<{ name: string; type: string }>;
      const colMap = Object.fromEntries(cols.map(c => [c.name, c.type]));
      expect(colMap['patientId']).toBe('TEXT');
      expect(colMap['imageId']).toBe('TEXT');
      expect(colMap['landmarkJson']).toBe('TEXT');
    });

    it('CephalometricAnalysisRecord 字段和 CHECK 约束', () => {
      const cols = migrationDb.prepare('PRAGMA table_info(CephalometricAnalysisRecord)').all() as Array<{ name: string; type: string }>;
      const colMap = Object.fromEntries(cols.map(c => [c.name, c.type]));
      expect(colMap['landmarkSetId']).toBe('TEXT');
      expect(colMap['method']).toBe('TEXT');
      expect(colMap['metricsJson']).toBe('TEXT');
      expect(colMap['analysisDate']).toBe('TEXT');

      migrationDb.prepare("INSERT INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES ('c1', 'Test Clinic', 'TC001', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run();
      migrationDb.prepare("INSERT INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt) VALUES ('p1', 'P001', '张三', 'MALE', '13800000000', 'c1', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run();
      migrationDb.prepare("INSERT INTO CephalometricLandmarkSet (id, clinicId, patientId, landmarkJson) VALUES ('ls1', 'c1', 'p1', '[]')").run();

      expect(() => {
        migrationDb.prepare("INSERT INTO CephalometricAnalysisRecord (id, clinicId, landmarkSetId, method, metricsJson, analysisDate) VALUES ('ar1', 'c1', 'ls1', 'INVALID_METHOD', '{}', '2024-01-01')").run();
      }).toThrow();

      expect(() => {
        migrationDb.prepare("INSERT INTO CephalometricAnalysisRecord (id, clinicId, landmarkSetId, method, metricsJson, analysisDate) VALUES ('ar1', 'c1', 'ls1', 'TWEED', '{}', '2024-01-01')").run();
      }).not.toThrow();
    });

    it('BusinessAlert CHECK 约束验证', () => {
      migrationDb.prepare("INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES ('c1', 'Test Clinic', 'TC001', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run();

      expect(() => {
        migrationDb.prepare("INSERT INTO BusinessAlert (id, clinicId, alertType, severity, metricName, message) VALUES ('ba1', 'c1', 'INVALID_TYPE', 'WARN', 'test', 'msg')").run();
      }).toThrow();

      expect(() => {
        migrationDb.prepare("INSERT INTO BusinessAlert (id, clinicId, alertType, severity, metricName, message, acknowledged) VALUES ('ba1', 'c1', 'REVENUE_DROP', 'INVALID_SEV', 'test', 'msg', 2)").run();
      }).toThrow();

      expect(() => {
        migrationDb.prepare("INSERT INTO BusinessAlert (id, clinicId, alertType, severity, metricName, message, acknowledged) VALUES ('ba1', 'c1', 'REVENUE_DROP', 'WARN', 'revenue', '收入下降', 1)").run();
      }).not.toThrow();
    });

    it('StaffLeaveRequest CHECK 约束验证', () => {
      migrationDb.prepare("INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES ('c1', 'Test Clinic', 'TC001', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run();
      migrationDb.prepare("INSERT OR IGNORE INTO User (id, username, passwordHash, name, role, clinicId, active) VALUES ('u1', 'doctor1', 'hash', '医生', 'DOCTOR', 'c1', 1)").run();

      expect(() => {
        migrationDb.prepare("INSERT INTO StaffLeaveRequest (id, clinicId, staffId, leaveType, startDate, endDate, daysCount, reason, status) VALUES ('slr1', 'c1', 'u1', 'INVALID_TYPE', '2024-01-01', '2024-01-02', 1, 'reason', 'SAVED')").run();
      }).toThrow();

      expect(() => {
        migrationDb.prepare("INSERT INTO StaffLeaveRequest (id, clinicId, staffId, leaveType, startDate, endDate, daysCount, reason, status) VALUES ('slr1', 'c1', 'u1', 'ANNUAL', '2024-01-01', '2024-01-02', 1, 'reason', 'INVALID_STATUS')").run();
      }).toThrow();

      expect(() => {
        migrationDb.prepare("INSERT INTO StaffLeaveRequest (id, clinicId, staffId, leaveType, startDate, endDate, daysCount, reason, status) VALUES ('slr1', 'c1', 'u1', 'ANNUAL', '2024-01-01', '2024-01-02', 1.5, '年假申请', 'PENDING')").run();
      }).not.toThrow();
    });

    it('DataImportJob CHECK 约束验证', () => {
      migrationDb.prepare("INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES ('c1', 'Test Clinic', 'TC001', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run();

      expect(() => {
        migrationDb.prepare("INSERT INTO DataImportJob (id, clinicId, importType, fileName, status) VALUES ('dij1', 'c1', 'INVALID_TYPE', 'test.xlsx', 'UPLOADED')").run();
      }).toThrow();

      expect(() => {
        migrationDb.prepare("INSERT INTO DataImportJob (id, clinicId, importType, fileName, status) VALUES ('dij1', 'c1', 'PATIENT', 'test.xlsx', 'INVALID_STATUS')").run();
      }).toThrow();

      expect(() => {
        migrationDb.prepare("INSERT INTO DataImportJob (id, clinicId, importType, fileName, status) VALUES ('dij1', 'c1', 'PATIENT', 'patients.xlsx', 'UPLOADED')").run();
      }).not.toThrow();
    });

    it('SatisfactionSurvey CHECK 约束验证', () => {
      migrationDb.prepare("INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES ('c1', 'Test Clinic', 'TC001', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run();
      migrationDb.prepare("INSERT OR IGNORE INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt) VALUES ('p1', 'P001', '张三', 'MALE', '13800000000', 'c1', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run();
      migrationDb.prepare("INSERT OR IGNORE INTO User (id, username, passwordHash, name, role, clinicId, active) VALUES ('u1', 'doctor1', 'hash', '医生', 'DOCTOR', 'c1', 1)").run();
      migrationDb.prepare("INSERT OR IGNORE INTO Visit (id, patientId, doctorId, clinicId) VALUES ('v1', 'p1', 'u1', 'c1')").run();

      expect(() => {
        migrationDb.prepare("INSERT INTO SatisfactionSurvey (id, clinicId, visitId, patientId, npsScore) VALUES ('ss1', 'c1', 'v1', 'p1', 11)").run();
      }).toThrow();

      expect(() => {
        migrationDb.prepare("INSERT INTO SatisfactionSurvey (id, clinicId, visitId, patientId, overallStars) VALUES ('ss1', 'c1', 'v1', 'p1', 6)").run();
      }).toThrow();

      expect(() => {
        migrationDb.prepare("INSERT INTO SatisfactionSurvey (id, clinicId, visitId, patientId, npsScore, overallStars, techStars, serviceStars, envStars) VALUES ('ss1', 'c1', 'v1', 'p1', 9, 5, 5, 4, 5)").run();
      }).not.toThrow();
    });

    it('PatientRiskScore CHECK 约束验证', () => {
      migrationDb.prepare("INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES ('c1', 'Test Clinic', 'TC001', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run();
      migrationDb.prepare("INSERT OR IGNORE INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt) VALUES ('p1', 'P001', '张三', 'MALE', '13800000000', 'c1', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run();

      expect(() => {
        migrationDb.prepare("INSERT INTO PatientRiskScore (id, clinicId, patientId, cariesScore, periodontalScore, implantScore, cariesLevel, factorSnapshotJson) VALUES ('prs1', 'c1', 'p1', 10, 5, 3, 'INVALID_LEVEL', '{}')").run();
      }).toThrow();

      expect(() => {
        migrationDb.prepare("INSERT INTO PatientRiskScore (id, clinicId, patientId, cariesScore, periodontalScore, implantScore, cariesLevel, periodontalLevel, implantLevel, factorSnapshotJson) VALUES ('prs1', 'c1', 'p1', 10, 5, 3, 'HIGH', 'MEDIUM', 'LOW', '{}')").run();
      }).not.toThrow();
    });

    it('DrugContraindication CHECK 约束验证', () => {
      migrationDb.prepare("INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES ('c1', 'Test Clinic', 'TC001', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)").run();

      expect(() => {
        migrationDb.prepare("INSERT INTO DrugContraindication (id, clinicId, severity, reason) VALUES ('dc1', 'c1', 'INVALID_SEV', '原因')").run();
      }).toThrow();

      expect(() => {
        migrationDb.prepare("INSERT INTO DrugContraindication (id, clinicId, severity, reason) VALUES ('dc1', 'c1', 'DANGER', '双硫仑样反应')").run();
      }).not.toThrow();
    });
  });
});
