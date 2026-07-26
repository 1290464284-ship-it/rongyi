import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { AppModule } from '../../src/app.module';
import { DbService } from '../../src/db/db.service';
import { resetTestMode, setTestMode } from '../../src/db/database';
import { CURRENT_VERSION } from '../../src/db/migrations';
import { TableNames } from '../../src/common/constants/table-names';

describe('Database Smoke Test', () => {
  let app: INestApplication;
  let dbService: DbService;

  beforeAll(async () => {
    resetTestMode();
    setTestMode(true);
    process.env.TEST_DB_MEMORY = '1';
    process.env.JWT_SECRET = 'TestJwtSecret2026ForDentalClinicApp0801abcXYZ9988';
    process.env.ENCRYPTION_KEY = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2';

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dbService = app.get(DbService);
  });

  afterAll(async () => {
    await app.close();
    resetTestMode();
    setTestMode(false);
    delete process.env.TEST_DB_MEMORY;
  });

  describe('数据库连接', () => {
    it('数据库连接应该正常', () => {
      const result = dbService.prepare('SELECT 1 AS ok').get() as { ok: number } | undefined;
      expect(result?.ok).toBe(1);
    });

    it('应该能执行基本查询', () => {
      const result = dbService.prepare("SELECT 'test' AS value").get() as { value: string } | undefined;
      expect(result?.value).toBe('test');
    });
  });

  describe('核心表存在性', () => {
    const coreTables = [
      TableNames.USER,
      TableNames.PATIENT,
      TableNames.APPOINTMENT,
      TableNames.VISIT,
      TableNames.TREATMENT,
      TableNames.TREATMENT_PLAN,
      TableNames.CHARGE,
      TableNames.CHARGE_ITEM,
      TableNames.PRESCRIPTION,
      TableNames.MEDICAL_RECORD,
      TableNames.INVENTORY_ITEM,
      TableNames.SUPPLIER,
      'MemberCard',
      TableNames.REFUND,
      TableNames.OPERATION_LOG,
      TableNames.CLINIC_INFO,
      TableNames.IDEMPOTENCY_RECORD,
    ];

    it.each(coreTables)('表 %s 应该存在', (tableName) => {
      const result = dbService.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      ).get(tableName) as { name: string } | undefined;
      expect(result).toBeDefined();
      expect(result?.name).toBe(tableName);
    });

    it('schema_migrations 迁移表应该存在', () => {
      const result = dbService.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = 'schema_migrations'"
      ).get() as { name: string } | undefined;
      expect(result).toBeDefined();
    });
  });

  describe('索引检查', () => {
    const importantIndexes = [
      { name: 'idx_user_username', table: 'User' },
      { name: 'idx_patient_name', table: 'Patient' },
      { name: 'idx_patient_phone', table: 'Patient' },
      { name: 'idx_appointment_doctor', table: 'Appointment' },
      { name: 'idx_appointment_patient', table: 'Appointment' },
      { name: 'idx_charge_patient', table: 'Charge' },
      { name: 'idx_charge_status', table: 'Charge' },
      { name: 'idx_visit_patient', table: 'Visit' },
      { name: 'idx_member_card_patient', table: 'MemberCard' },
    ];

    it.each(importantIndexes)('索引 $name (表 $table) 应该存在', ({ name, table }) => {
      const result = dbService.prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND name = ? AND tbl_name = ?"
      ).get(name, table) as { name: string } | undefined;
      expect(result).toBeDefined();
    });
  });

  describe('迁移状态', () => {
    it('迁移版本号应该达到最新版本', () => {
      const result = dbService.prepare('PRAGMA user_version').get() as { user_version: number };
      expect(result.user_version).toBe(CURRENT_VERSION);
    });

    it('schema_migrations 表应该包含所有迁移记录', () => {
      const migrations = dbService.prepare(
        'SELECT version FROM schema_migrations ORDER BY version'
      ).all() as Array<{ version: string }>;

      expect(migrations.length).toBeGreaterThan(0);

      const versions = migrations.map(m => parseInt(m.version, 10));
      for (let v = 1; v <= CURRENT_VERSION; v++) {
        expect(versions).toContain(v);
      }
    });

    it('迁移版本号应该正确递增', () => {
      const migrations = dbService.prepare(
        'SELECT version FROM schema_migrations ORDER BY CAST(version AS INTEGER)'
      ).all() as Array<{ version: string }>;

      const versions = migrations.map(m => parseInt(m.version, 10));
      for (let i = 1; i < versions.length; i++) {
        expect(versions[i]).toBeGreaterThan(versions[i - 1]);
      }
    });
  });

  describe('基本 CRUD 操作', () => {
    const CLINIC_ID = 'smoke-crud-clinic';
    const USER_ID = 'smoke-crud-user';

    beforeAll(() => {
      // 插入测试诊所和管理员（CRUD 测试的外键依赖）
      dbService.prepare(
        'INSERT OR IGNORE INTO Clinic (id, name, code, isActive, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)'
      ).run(CLINIC_ID, 'CRUD 测试诊所', 'CRUD001', 1, new Date().toISOString(), new Date().toISOString());

      dbService.prepare(
        'INSERT OR IGNORE INTO User (id, username, passwordHash, name, role, active, clinicId, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?)'
      ).run(USER_ID, 'crud_tester', 'hash', 'CRUD 测试员', 'DOCTOR', CLINIC_ID, new Date().toISOString(), new Date().toISOString());
    });

    it('INSERT 应该能插入数据', () => {
      const patientId = 'smoke-patient-crud';
      const now = new Date().toISOString();
      const result = dbService.prepare(
        'INSERT INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)'
      ).run(patientId, 'P-CRUD-001', 'CRUD 测试患者', 'MALE', '13900001111', CLINIC_ID, now, now);

      expect(result.changes).toBe(1);
    });

    it('SELECT 应该能查询数据', () => {
      const row = dbService.prepare(
        'SELECT id, name, phone FROM Patient WHERE id = ?'
      ).get('smoke-patient-crud') as { id: string; name: string; phone: string } | undefined;

      expect(row).toBeDefined();
      expect(row!.name).toBe('CRUD 测试患者');
      expect(row!.phone).toBe('13900001111');
    });

    it('UPDATE 应该能更新数据', () => {
      const result = dbService.prepare(
        "UPDATE Patient SET name = ?, updatedAt = datetime('now') WHERE id = ?"
      ).run('CRUD 测试患者-已更新', 'smoke-patient-crud');

      expect(result.changes).toBe(1);

      const row = dbService.prepare(
        'SELECT name FROM Patient WHERE id = ?'
      ).get('smoke-patient-crud') as { name: string } | undefined;

      expect(row!.name).toBe('CRUD 测试患者-已更新');
    });

    it('DELETE 应该能删除数据', () => {
      // 先插入一条待删除记录
      const now = new Date().toISOString();
      dbService.prepare(
        'INSERT INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)'
      ).run('smoke-patient-del', 'P-DEL-001', '待删除患者', 'FEMALE', '13900002222', CLINIC_ID, now, now);

      const result = dbService.prepare('DELETE FROM Patient WHERE id = ?').run('smoke-patient-del');
      expect(result.changes).toBe(1);

      const row = dbService.prepare('SELECT id FROM Patient WHERE id = ?').get('smoke-patient-del');
      expect(row).toBeUndefined();
    });

    it('软删除应该能正常执行', () => {
      const now = new Date().toISOString();
      dbService.prepare(
        'INSERT INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)'
      ).run('smoke-patient-soft', 'P-SOFT-001', '软删除患者', 'MALE', '13900003333', CLINIC_ID, now, now);

      const result = dbService.prepare(
        "UPDATE Patient SET deletedAt = datetime('now'), updatedAt = datetime('now') WHERE id = ?"
      ).run('smoke-patient-soft');

      expect(result.changes).toBe(1);

      const row = dbService.prepare(
        'SELECT deletedAt FROM Patient WHERE id = ?'
      ).get('smoke-patient-soft') as { deletedAt: string } | undefined;

      expect(row!.deletedAt).toBeTruthy();
    });

    it('事务应该能正常回滚', () => {
      const now = new Date().toISOString();

      // 在事务中插入后回滚
      try {
        dbService.transaction((db) => {
          (db as any).prepare(
            'INSERT INTO Patient (id, code, name, gender, phone, clinicId, active, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)'
          ).run('smoke-patient-tx', 'P-TX-001', '事务患者', 'MALE', '13900004444', CLINIC_ID, now, now);
          throw new Error('模拟回滚');
        });
      } catch {
        // 预期回滚
      }

      const row = dbService.prepare('SELECT id FROM Patient WHERE id = ?').get('smoke-patient-tx');
      expect(row).toBeUndefined();
    });

    afterAll(() => {
      // 清理 CRUD 测试数据
      dbService.prepare('DELETE FROM Patient WHERE clinicId = ?').run(CLINIC_ID);
      dbService.prepare('DELETE FROM User WHERE id = ?').run(USER_ID);
      dbService.prepare('DELETE FROM Clinic WHERE id = ?').run(CLINIC_ID);
    });
  });
});
