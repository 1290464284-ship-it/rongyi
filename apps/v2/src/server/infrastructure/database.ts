import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { resourceRegistry } from '../../domain/resources';
import type { ResourceField } from '../../domain/contracts';

function columnType(field: ResourceField): string {
  switch (field.type) {
    case 'money':
      return 'INTEGER';
    case 'number':
    case 'decimal':
      return 'REAL';
    case 'boolean':
      return 'INTEGER';
    case 'date':
    case 'datetime':
    case 'json':
    case 'text':
    case 'longText':
    case 'enum':
    case 'relation':
      return 'TEXT';
    default: {
      // B-L1：删掉死代码。未登记的类型直接抛错，避免未来新增类型被静默降级为 TEXT
      // （列类型与元数据不一致会造成查询/校验行为漂移，且难以排查）。
      const unsupportedType: string = field.type as string;
      throw new Error(`Unsupported column type: ${unsupportedType}`);
    }
  }
}

function createTableSql(table: string, fields: ResourceField[]): string {
  const columns = [
    'id TEXT PRIMARY KEY',
    'clinicId TEXT',
    'createdAt TEXT NOT NULL',
    'updatedAt TEXT NOT NULL',
    'deletedAt TEXT',
    ...fields.map((field) => `${field.name} ${columnType(field)}`),
  ];
  return `CREATE TABLE IF NOT EXISTS ${table} (${columns.join(', ')})`;
}

function createChildTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ChargeItem (
      id TEXT PRIMARY KEY,
      chargeId TEXT NOT NULL,
      treatmentId TEXT,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price INTEGER NOT NULL,
      quantity REAL NOT NULL,
      teethNumbers TEXT NOT NULL DEFAULT '[]',
      subtotal INTEGER NOT NULL,
      clinicId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS TreatmentPlanItem (
      id TEXT PRIMARY KEY,
      planId TEXT NOT NULL,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      price INTEGER NOT NULL,
      quantity REAL NOT NULL,
      teethNumbers TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      treatmentId TEXT,
      completedAt TEXT,
      remark TEXT,
      clinicId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS PrescriptionItem (
      id TEXT PRIMARY KEY,
      prescriptionId TEXT NOT NULL,
      drugId TEXT,
      name TEXT NOT NULL,
      specification TEXT,
      dosage TEXT,
      frequency TEXT,
      days REAL NOT NULL,
      quantity REAL NOT NULL,
      price INTEGER NOT NULL,
      clinicId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS PurchaseOrderItem (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      itemId TEXT,
      name TEXT NOT NULL,
      spec TEXT,
      quantity REAL NOT NULL,
      unitPrice INTEGER NOT NULL,
      subtotal INTEGER NOT NULL,
      clinicId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS ProcessingOrderItem (
      id TEXT PRIMARY KEY,
      orderId TEXT NOT NULL,
      name TEXT NOT NULL,
      spec TEXT,
      quantity REAL NOT NULL,
      unitPrice INTEGER NOT NULL,
      subtotal INTEGER NOT NULL,
      status TEXT NOT NULL,
      clinicId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS OperationLog (
      id TEXT PRIMARY KEY,
      userId TEXT,
      userName TEXT,
      action TEXT NOT NULL,
      target TEXT,
      detail TEXT,
      ip TEXT,
      traceId TEXT,
      clinicId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS BackupRecord (
      id TEXT PRIMARY KEY,
      clinicId TEXT,
      filename TEXT NOT NULL,
      fileSize INTEGER,
      type TEXT DEFAULT 'MANUAL',
      operatorId TEXT,
      operatorName TEXT,
      remark TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS IdempotencyRecord (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      type TEXT DEFAULT 'GENERIC',
      status TEXT DEFAULT 'COMPLETED',
      responseJson TEXT NOT NULL,
      result TEXT,
      userId TEXT,
      clinicId TEXT,
      operation TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      expiresAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '+1 day'))
    );

    CREATE TABLE IF NOT EXISTS SyncChange (
      id TEXT PRIMARY KEY,
      clinicId TEXT,
      tableName TEXT NOT NULL,
      recordId TEXT NOT NULL,
      operation TEXT NOT NULL,
      deviceId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS SyncDevice (
      id TEXT PRIMARY KEY,
      clinicId TEXT,
      userId TEXT,
      deviceId TEXT NOT NULL,
      tokenHash TEXT NOT NULL,
      name TEXT,
      active INTEGER DEFAULT 1,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT,
      UNIQUE (clinicId, deviceId)
    );

    CREATE TABLE IF NOT EXISTS InventoryReplenishmentSuggestion (
      id TEXT PRIMARY KEY,
      clinicId TEXT,
      inventoryId TEXT NOT NULL,
      avgDailyConsumption REAL,
      leadTimeDays INTEGER DEFAULT 7,
      safetyFactor REAL DEFAULT 1.5,
      rop REAL NOT NULL,
      suggestedQty INTEGER NOT NULL,
      calculationSnapshotJson TEXT,
      status TEXT,
      supplierId TEXT,
      totalAmount INTEGER,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS PrintTemplate (
      id TEXT PRIMARY KEY,
      clinicId TEXT,
      code TEXT NOT NULL,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      content TEXT NOT NULL,
      variables TEXT DEFAULT '{}',
      isDefault INTEGER DEFAULT 0,
      paperSize TEXT DEFAULT 'A4',
      orientation TEXT DEFAULT 'portrait',
      createdBy TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );

    CREATE TABLE IF NOT EXISTS FileRecord (
      id TEXT PRIMARY KEY,
      clinicId TEXT,
      patientId TEXT,
      filename TEXT NOT NULL,
      originalName TEXT NOT NULL,
      mimeType TEXT NOT NULL,
      fileSize INTEGER NOT NULL,
      createdBy TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
    );
  `);
}

// legacy schema 同步职责（M-04：由 database.ts 拆分，此处 re-export 保持兼容）
export { extractCreateTableStatements, syncLegacySchema } from './legacy-schema';

export function createDatabase(
  dataDir = process.env.V2_DATA_DIR ?? path.resolve(process.cwd(), 'data'),
  dbPath?: string,
  options?: { fullIntegrityCheck?: boolean },
): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const resolvedDbPath = dbPath ?? path.join(dataDir, 'v2.sqlite');
  const db = new Database(resolvedDbPath);
  const fullCheck = options?.fullIntegrityCheck ?? false;
  const result = db.pragma(fullCheck ? 'integrity_check' : 'quick_check') as Array<{ [key: string]: string }>;
  if (result.length !== 1 || result[0][fullCheck ? 'integrity_check' : 'quick_check'] !== 'ok') {
    db.close();
    throw new Error('SQLite integrity check failed');
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.pragma('cache_size = -20000');
  db.pragma('mmap_size = 268435456');
  db.pragma('temp_store = MEMORY');
  const createSchema = db.transaction(() => {
    for (const resource of resourceRegistry.all()) {
      db.exec(createTableSql(resource.table, resource.fields));
    }
    createChildTables(db);
    alignLegacyTables(db);
    createUniqueIndexes(db);
  });
  createSchema();
  return db;
}

/**
 * Round7 smoke fix: the legacy database shipped with the installer (and any
 * real 2.1.x installation) predates the V2 resource schema. `CREATE TABLE IF
 * NOT EXISTS` only creates missing tables, so existing legacy tables keep
 * their old columns — e.g. ChargeCombo has no `code` column — and
 * createUniqueIndexes() then fails with "no such column: code", which crashed
 * every fresh install / 2.1.x upgrade at startup. This step aligns existing
 * resource tables with the declared schema: it adds missing columns and
 * backfills unique columns with deterministic per-row values (LEGACY-<rowid>)
 * so the subsequent unique index creation succeeds. Non-unique columns are
 * added as nullable; required-ness is enforced by the application layer.
 */
function alignLegacyTables(db: Database.Database): void {
  for (const resource of resourceRegistry.all()) {
    const table = resource.table;
    const tableExists = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
      .get(table);
    if (!tableExists) continue;
    const existingColumns = new Set(
      (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name),
    );
    for (const field of resource.fields) {
      if (existingColumns.has(field.name)) continue;
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${field.name} ${columnType(field)}`);
      if (field.unique) {
        db.exec(`UPDATE ${table} SET ${field.name} = 'LEGACY-' || printf('%08d', rowid) WHERE ${field.name} IS NULL`);
      }
    }
  }
}

export function uniqueIndexColumns(db: Database.Database, table: string, fieldName: string): string {
  const hasClinicColumn = (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>)
    .some((column) => column.name === 'clinicId');
  return hasClinicColumn ? `clinicId, ${fieldName}` : fieldName;
}

function createUniqueIndexes(db: Database.Database): void {
  for (const resource of resourceRegistry.all()) {
    for (const field of resource.fields) {
      if (field.unique) {
        const indexColumns = uniqueIndexColumns(db, resource.table, field.name);
        db.exec(
          `CREATE UNIQUE INDEX IF NOT EXISTS idx_v2_unique_${resource.name}_${field.name}
           ON ${resource.table} (${indexColumns}) WHERE deletedAt IS NULL`,
        );
      }
    }
  }
}

export function seedDatabase(db: Database.Database): void {
  const now = new Date().toISOString();
  const isProduction = process.env.NODE_ENV === 'production';
  // 默认密码与 smoke 脚本共享；CI/本地可通过 V2_ADMIN_PASSWORD 覆盖。
  const seedPassword = process.env.V2_ADMIN_PASSWORD ?? 'REDACTED';
  const clinicRow = db.prepare('SELECT id FROM Clinic LIMIT 1').get() as { id: string } | undefined;
  const clinicId = clinicRow ? String(clinicRow.id) : 'clinic-v2-001';
  if (!clinicRow) {
    db.prepare(
      `INSERT INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'V2', 'Refactored Clinic', 1)`,
    ).run(clinicId, now, now);
  }

  const adminRow = db.prepare("SELECT id, passwordHash FROM User WHERE username = 'admin'").get() as
    | { id: string; passwordHash: string }
    | undefined;
  const userId = adminRow?.id ?? 'user-admin-001';
  if (!adminRow) {
    if (isProduction) {
      // Production bootstrap: an operator-provided V2_ADMIN_PASSWORD creates
      // the first admin. Without it the app refuses to start, so no default
      // credentials are ever shipped.
      const bootstrapPassword = process.env.V2_ADMIN_PASSWORD;
      if (!bootstrapPassword || bootstrapPassword.length < 6) {
        throw new Error(
          'Production database must contain an admin user; ' +
            'set V2_ADMIN_PASSWORD (min 6 chars) to bootstrap one on first start',
        );
      }
      const passwordHash = bcrypt.hashSync(bootstrapPassword, 10);
      db.prepare(
        `INSERT INTO User (
           id, clinicId, createdAt, updatedAt, deletedAt,
           username, passwordHash, name, role, active, loginAttempts, tokenVersion
         ) VALUES (?, ?, ?, ?, NULL, 'admin', ?, 'System Administrator', 'BOSS', 1, 0, 0)`,
      ).run(userId, clinicId, now, now, passwordHash);
      console.warn('[seed] production admin bootstrap: admin created from V2_ADMIN_PASSWORD; change the password after first login');
    } else {
      const passwordHash = bcrypt.hashSync(seedPassword, 10);
      db.prepare(
        `INSERT INTO User (
           id, clinicId, createdAt, updatedAt, deletedAt,
           username, passwordHash, name, role, active, loginAttempts, tokenVersion
         ) VALUES (?, ?, ?, ?, NULL, 'admin', ?, 'System Administrator', 'BOSS', 1, 0, 0)`,
      ).run(userId, clinicId, now, now, passwordHash);
    }
  }
  // 非生产且未显式配置 V2_ADMIN_PASSWORD 时，提醒默认管理员口令已生效；
  // 测试环境静默，避免测试输出噪音。
  if (!isProduction && !process.env.V2_ADMIN_PASSWORD && process.env.NODE_ENV !== 'test') {
    console.warn('[seed] V2_ADMIN_PASSWORD not set: admin user uses the default seed password. Set V2_ADMIN_PASSWORD before first launch to harden credentials.');
  }

  const doctorRow = db.prepare("SELECT id FROM User WHERE username = 'doctor'").get() as { id: string } | undefined;
  if (!doctorRow && !isProduction) {
    const doctorHash = bcrypt.hashSync('REDACTED', 10);
    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES (?, ?, ?, ?, NULL, 'doctor', ?, 'Default Doctor', 'DOCTOR', 1, 0, 0)`,
    ).run('user-seed-doctor-001', clinicId, now, now, doctorHash);
  }

  if (!isProduction) {
    db.prepare(
      `INSERT OR IGNORE INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'P001', 'Demo Patient', 'UNKNOWN', '13800000000',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-demo-001', clinicId, now, now);

    db.prepare(
      `INSERT OR IGNORE INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('appointment-demo-001', clinicId, now, now, userId, now, new Date(Date.now() + 3_600_000).toISOString());

    db.prepare(
      `INSERT OR IGNORE INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'MAT-001', 'Dental Material', 'CONSUMABLE', 'box', 100, 20, 5000)`,
    ).run('inventory-demo-001', clinicId, now, now);

    db.prepare(
      `INSERT OR IGNORE INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Post-treatment review', 'PENDING')`,
    ).run('followup-demo-001', clinicId, now, now, new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  }
}
