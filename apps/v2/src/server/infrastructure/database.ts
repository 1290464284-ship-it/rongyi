import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
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

/**
 * Non-unique indexes for the analytics/pagination hot paths. Called after
 * migrations so tables created by migration steps are covered too; each
 * definition is skipped when its table or a referenced column is absent.
 */
export function createPerformanceIndexes(db: Database.Database): void {
  const indexDefs: Array<{ name: string; table: string; columns: string[] }> = [
    { name: 'idx_v2_perf_charge_patient', table: 'Charge', columns: ['patientId', 'deletedAt'] },
    { name: 'idx_v2_perf_charge_patient_paid', table: 'Charge', columns: ['patientId', 'paidAt', 'deletedAt'] },
    { name: 'idx_v2_perf_charge_clinic_created', table: 'Charge', columns: ['clinicId', 'createdAt'] },
    { name: 'idx_v2_perf_charge_doctor', table: 'Charge', columns: ['doctorId', 'deletedAt'] },
    { name: 'idx_v2_perf_visit_patient', table: 'Visit', columns: ['patientId', 'deletedAt'] },
    { name: 'idx_v2_perf_appointment_start_clinic', table: 'Appointment', columns: ['clinicId', 'startTime'] },
    { name: 'idx_v2_perf_registration_start_clinic', table: 'Registration', columns: ['clinicId', 'registeredAt'] },
    { name: 'idx_v2_perf_followup_status_plan', table: 'FollowUp', columns: ['status', 'planDate', 'deletedAt'] },
    { name: 'idx_v2_perf_chargeitem_charge', table: 'ChargeItem', columns: ['chargeId', 'deletedAt'] },
    { name: 'idx_v2_perf_chargeitem_cost', table: 'ChargeItem', columns: ['costType', 'deletedAt'] },
    { name: 'idx_v2_perf_notification_user', table: 'Notification', columns: ['userId', 'createdAt'] },
    { name: 'idx_v2_perf_attendance_clinic_date', table: 'Attendance', columns: ['clinicId', 'workDate'] },
    { name: 'idx_v2_perf_syncchange_cursor', table: 'SyncChange', columns: ['clinicId', 'createdAt', 'rowid'] },
  ];
  for (const def of indexDefs) {
    const tableExists = db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(def.table);
    if (!tableExists) continue;
    const columns = new Set(
      (db.prepare(`PRAGMA table_info(${def.table})`).all() as Array<{ name: string }>).map((column) => column.name),
    );
    if (!def.columns.every((column) => columns.has(column))) continue;
    db.exec(`CREATE INDEX IF NOT EXISTS ${def.name} ON ${def.table} (${def.columns.join(', ')})`);
  }
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

export { seedDatabase } from './seed';
