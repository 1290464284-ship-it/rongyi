import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { resourceRegistry } from '../../domain/resources';
import type { ResourceField } from '../../domain/contracts';

function columnType(field: ResourceField): string {
  switch (field.type) {
    case 'number':
    case 'money':
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
      price REAL NOT NULL,
      quantity REAL NOT NULL,
      teethNumbers TEXT NOT NULL DEFAULT '[]',
      subtotal REAL NOT NULL,
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
      price REAL NOT NULL,
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
      price REAL NOT NULL,
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
      unitPrice REAL NOT NULL,
      subtotal REAL NOT NULL,
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
      unitPrice REAL NOT NULL,
      subtotal REAL NOT NULL,
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

    CREATE TABLE IF NOT EXISTS IdempotencyRecord (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      responseJson TEXT NOT NULL,
      clinicId TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      deletedAt TEXT
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
      totalAmount REAL,
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
  if (!fs.existsSync(schemaDir)) return;
  const files = fs.readdirSync(schemaDir).filter((name) => name.endsWith('.tables.ts'));
  db.pragma('foreign_keys = OFF');
  try {
    for (const file of files) {
      const content = fs.readFileSync(path.join(schemaDir, file), 'utf8');
      for (const statement of extractCreateTableStatements(content)) {
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
): Database.Database {
  fs.mkdirSync(dataDir, { recursive: true });
  const resolvedDbPath = dbPath ?? path.join(dataDir, 'v2.sqlite');
  const db = new Database(resolvedDbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec('BEGIN');
  try {
    for (const resource of resourceRegistry.all()) {
      db.exec(createTableSql(resource.table, resource.fields));
    }
    createChildTables(db);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return db;
}

export function seedDatabase(db: Database.Database): void {
  const now = new Date().toISOString();
  const passwordHash = bcrypt.hashSync('admin123', 10);
  const clinicCount = db.prepare('SELECT COUNT(*) AS count FROM Clinic').get() as { count: number };
  if (clinicCount.count > 0) return;

  const clinicId = 'clinic-v2-001';
  const userId = 'user-admin-001';

  db.prepare(
    `INSERT INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
     VALUES (?, NULL, ?, ?, NULL, 'V2', 'Refactored Clinic', 1)`,
  ).run(clinicId, now, now);

  db.prepare(
    `INSERT INTO User (
       id, clinicId, createdAt, updatedAt, deletedAt,
       username, passwordHash, name, role, active, loginAttempts, tokenVersion
     ) VALUES (?, ?, ?, ?, NULL, 'admin', ?, 'System Administrator', 'BOSS', 1, 0, 0)`,
  ).run(
    userId,
    clinicId,
    now,
    now,
    passwordHash,
  );

  db.prepare(
    `INSERT INTO Patient (
       id, clinicId, createdAt, updatedAt, deletedAt,
       code, name, gender, phone, tags, allergies, medicalHistory,
       medicationHistory, systemicDiseases, source, active
     ) VALUES (?, ?, ?, ?, NULL, 'P001', 'Demo Patient', 'UNKNOWN', '13800000000',
       '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
  ).run('patient-demo-001', clinicId, now, now);

  db.prepare(
    `INSERT INTO Appointment (
       id, clinicId, createdAt, updatedAt, deletedAt,
       patientId, doctorId, startTime, endTime, status, type
     ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, ?, ?, 'BOOKED', 'REGULAR')`,
  ).run('appointment-demo-001', clinicId, now, now, userId, now, new Date(Date.now() + 3_600_000).toISOString());

  db.prepare(
    `INSERT INTO InventoryItem (
       id, clinicId, createdAt, updatedAt, deletedAt,
       code, name, category, unit, stock, minStock, price
     ) VALUES (?, ?, ?, ?, NULL, 'MAT-001', 'Dental Material', 'CONSUMABLE', 'box', 100, 20, 5000)`,
  ).run('inventory-demo-001', clinicId, now, now);

  db.prepare(
    `INSERT INTO FollowUp (
       id, clinicId, createdAt, updatedAt, deletedAt,
       patientId, planDate, content, status
     ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Post-treatment review', 'PENDING')`,
  ).run('followup-demo-001', clinicId, now, now, new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
}
