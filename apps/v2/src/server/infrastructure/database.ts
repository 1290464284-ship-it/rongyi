import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { INTERNAL_RESOURCE_TABLES, resourceRegistry } from '../../domain/resources';
import type { ResourceField } from '../../domain/contracts';

function columnType(field: ResourceField): string {
  switch (field.type) {
    case 'money':
      return 'INTEGER';
    case 'number':
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
      const unsupportedType: string = field.type as string;
      return 'TEXT';
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

function extractCreateTableStatements(text: string): string[] {
  const statements: string[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const start = text.indexOf('CREATE TABLE IF NOT EXISTS', cursor);
    if (start === -1) break;
    const parenStart = text.indexOf('(', start);
    if (parenStart === -1) break;
    let depth = 0;
    let end = -1;
    for (let i = parenStart; i < text.length; i += 1) {
      const char = text[i];
      if (char === '(') depth += 1;
      else if (char === ')') {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end === -1) break;
    statements.push(text.slice(start, end + 1));
    cursor = end + 1;
  }
  return statements;
}

export function syncLegacySchema(db: Database.Database, schemaDir: string): void {
  // 条件化：测试环境跳过；schema 目录不存在时跳过
  if (process.env.NODE_ENV === 'test') return;
  if (!fs.existsSync(schemaDir)) return;
  const allowedTables = new Set([
    ...resourceRegistry.all().map((resource) => resource.table),
    ...INTERNAL_RESOURCE_TABLES,
  ]);
  const files = fs.readdirSync(schemaDir).filter((name) => name.endsWith('.tables.ts'));
  if (files.length === 0) return;
  db.pragma('foreign_keys = OFF');
  try {
    for (const file of files) {
      const content = fs.readFileSync(path.join(schemaDir, file), 'utf8');
      for (const statement of extractCreateTableStatements(content)) {
        const tableMatch = /CREATE TABLE IF NOT EXISTS\s+([A-Za-z_][A-Za-z0-9_]*)/.exec(statement);
        if (!tableMatch || !allowedTables.has(tableMatch[1])) continue;
        db.exec(`${statement};`);
      }
    }
  } finally {
    db.pragma('foreign_keys = ON');
  }
}

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
    createUniqueIndexes(db);
  });
  createSchema();
  return db;
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
      throw new Error('Production database must contain an admin user; refusing to seed default credentials');
    }
    const passwordHash = bcrypt.hashSync('admin123', 10);
    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES (?, ?, ?, ?, NULL, 'admin', ?, 'System Administrator', 'BOSS', 1, 0, 0)`,
    ).run(userId, clinicId, now, now, passwordHash);
  } else if (process.env.NODE_ENV === 'development' && process.env.V2_ALLOW_DEV_SEED === '1') {
    const passwordHash = bcrypt.hashSync('admin123', 10);
    db.prepare('UPDATE User SET passwordHash = ?, active = 1, lockedUntil = NULL, updatedAt = ? WHERE id = ?')
      .run(passwordHash, now, userId);
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
