import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from './database';
import { migrations, runMigrations, withMigrationBusyRetry } from './migrations';

describe('migrations', () => {
  let db: Database.Database;
  let dataDir: string;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-'));
    db = createDatabase(dataDir);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('applies pending migrations once and records versions', () => {
    runMigrations(db);
    runMigrations(db);
    const rows = db.prepare('SELECT version, name FROM schema_migrations ORDER BY version').all() as Array<{
      version: number;
      name: string;
    }>;
    expect(rows.map((row) => ({ version: Number(row.version), name: row.name }))).toEqual(
      migrations.map((migration) => ({ version: migration.version, name: migration.name })),
    );
  });

  it('skips virtual tables during base column sync', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-vtab-'));
    const fresh = createDatabase(dir);
    fresh.exec('CREATE VIRTUAL TABLE IF NOT EXISTS DummyFts USING fts5(content)');
    const migration = migrations.find((item) => item.version === 107);
    expect(migration).toBeDefined();
    expect(() => migration?.up(fresh)).not.toThrow();
    fresh.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('retries migrations when another process holds the schema lock', () => {
    const attempts: number[] = [];
    const run = () => {
      attempts.push(attempts.length + 1);
      if (attempts.length < 3) {
        const error = new Error('database is locked');
        (error as { code?: string }).code = 'SQLITE_BUSY';
        throw error;
      }
      return 42;
    };
    const wait = vi.spyOn(Atomics, 'wait').mockImplementation(() => 'ok' as const);
    try {
      expect(withMigrationBusyRetry(run)).toBe(42);
      expect(attempts).toEqual([1, 2, 3]);
    } finally {
      wait.mockRestore();
    }
  });

  it('rethrows non-busy migration errors immediately', () => {
    expect(() => withMigrationBusyRetry(() => {
      throw new Error('boom');
    })).toThrow('boom');
  });

  it('adds missing migration columns when legacy schema lacks them', () => {
    const freshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-fresh-'));
    const freshDb = createDatabase(freshDir);
    freshDb.exec('ALTER TABLE OperationLog DROP COLUMN traceId');
    freshDb.exec('ALTER TABLE IdempotencyRecord DROP COLUMN responseJson');
    freshDb.exec('ALTER TABLE IdempotencyRecord DROP COLUMN type');
    freshDb.exec('ALTER TABLE IdempotencyRecord DROP COLUMN userId');
    freshDb.exec('ALTER TABLE IdempotencyRecord DROP COLUMN operation');
    freshDb.exec('ALTER TABLE Patient DROP COLUMN occupation');
    freshDb.exec('ALTER TABLE ProcessingOrderItem DROP COLUMN name');
    freshDb.exec('ALTER TABLE InventoryReplenishmentSuggestion DROP COLUMN status');
    runMigrations(freshDb);
    const operationLog = freshDb.prepare('PRAGMA table_info(OperationLog)').all() as Array<{ name: string }>;
    const idempotency = freshDb.prepare('PRAGMA table_info(IdempotencyRecord)').all() as Array<{ name: string }>;
    const patient = freshDb.prepare('PRAGMA table_info(Patient)').all() as Array<{ name: string }>;
    const item = freshDb.prepare('PRAGMA table_info(ProcessingOrderItem)').all() as Array<{ name: string }>;
    const suggestion = freshDb.prepare('PRAGMA table_info(InventoryReplenishmentSuggestion)').all() as Array<{ name: string }>;
    expect(operationLog.some((column) => column.name === 'traceId')).toBe(true);
    expect(idempotency.some((column) => column.name === 'responseJson')).toBe(true);
    expect(idempotency.some((column) => column.name === 'type')).toBe(true);
    expect(idempotency.some((column) => column.name === 'userId')).toBe(true);
    expect(idempotency.some((column) => column.name === 'operation')).toBe(true);
    expect(patient.some((column) => column.name === 'occupation')).toBe(true);
    expect(item.some((column) => column.name === 'name')).toBe(true);
    expect(suggestion.some((column) => column.name === 'status')).toBe(true);
    freshDb.close();
    fs.rmSync(freshDir, { recursive: true, force: true });
  });

  it('skips migration columns that already exist and covers both column expressions', () => {
    const existingDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-existing-'));
    const existingDb = createDatabase(existingDir);
    existingDb.exec('ALTER TABLE User ADD COLUMN refreshToken TEXT');
    existingDb.exec('ALTER TABLE User ADD COLUMN refreshTokenExpiresAt TEXT');
    existingDb.exec('ALTER TABLE User ADD COLUMN currentClinicId TEXT');
    runMigrations(existingDb);
    const userColumns = new Set(
      (existingDb.prepare('PRAGMA table_info(User)').all() as Array<{ name: string }>).map((column) => column.name),
    );
    expect(userColumns.has('refreshToken')).toBe(true);
    expect(userColumns.has('refreshTokenExpiresAt')).toBe(true);
    existingDb.close();
    fs.rmSync(existingDir, { recursive: true, force: true });

    const responseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-response-'));
    const responseDb = createDatabase(responseDir);
    responseDb.exec('ALTER TABLE IdempotencyRecord DROP COLUMN clinicId');
    runMigrations(responseDb);
    const idemColumns = new Set(
      (responseDb.prepare('PRAGMA table_info(IdempotencyRecord)').all() as Array<{ name: string }>).map((column) => column.name),
    );
    expect(idemColumns.has('responseJson')).toBe(true);
    expect(idemColumns.has('clinicId')).toBe(true);
    responseDb.close();
    fs.rmSync(responseDir, { recursive: true, force: true });
  });

  it('adds the charge member-card column when migration 114 runs on an older schema', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-114-'));
    const oldDb = createDatabase(dir);
    runMigrations(oldDb);
    oldDb.exec('DROP INDEX IF EXISTS idx_v2_charge_member_card');
    oldDb.exec('ALTER TABLE Charge DROP COLUMN memberCardId');
    oldDb.prepare('DELETE FROM schema_migrations WHERE version = ?').run('114');
    runMigrations(oldDb);
    const columns = new Set(
      (oldDb.prepare('PRAGMA table_info(Charge)').all() as Array<{ name: string }>).map((column) => column.name),
    );
    expect(columns.has('memberCardId')).toBe(true);
    oldDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('adds and enforces foreign keys for core tables', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-fk-'));
    const freshDb = createDatabase(dir);
    runMigrations(freshDb);
    const memberFk = freshDb.prepare('PRAGMA foreign_key_list(MemberCard)').all();
    const refundFk = freshDb.prepare('PRAGMA foreign_key_list(Refund)').all();
    const chargeItemFk = freshDb.prepare('PRAGMA foreign_key_list(ChargeItem)').all();
    const purchaseItemFk = freshDb.prepare('PRAGMA foreign_key_list(PurchaseOrderItem)').all();
    const inventoryTxFk = freshDb.prepare('PRAGMA foreign_key_list(InventoryTransaction)').all();
    const processingFk = freshDb.prepare('PRAGMA foreign_key_list(ProcessingOrder)').all();
    const userColumns = freshDb.prepare('PRAGMA table_info(User)').all() as Array<{ name: string }>;
    const userClinicTable = freshDb.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'UserClinic'").get();
    expect(memberFk.length).toBeGreaterThan(0);
    expect(refundFk.length).toBeGreaterThan(0);
    expect(chargeItemFk.length).toBeGreaterThan(0);
    expect(purchaseItemFk.length).toBeGreaterThan(0);
    expect(inventoryTxFk.length).toBeGreaterThan(0);
    expect(processingFk.length).toBeGreaterThan(0);
    expect(userColumns.some((column) => column.name === 'currentClinicId')).toBe(true);
    expect(userClinicTable).toBeDefined();

    const now = new Date().toISOString();
    freshDb.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'FK-P', 'FK Patient', 'UNKNOWN', '13000000000',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('fk-patient', 'clinic-v2-001', now, now);
    expect(() => freshDb.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, 'missing-patient', 'CARD-FK', 0, 0, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('fk-card', 'clinic-v2-001', now, now)).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => freshDb.prepare(
      `INSERT INTO Refund (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, amount, reason
       ) VALUES (?, ?, ?, ?, NULL, 'missing-charge', 'fk-patient', 100, 'test')`,
    ).run('fk-refund', 'clinic-v2-001', now, now)).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => freshDb.prepare(
      `INSERT INTO ChargeItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, name, category, price, quantity, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'missing-charge', 'Item', 'EXAM', 100, 1, 100)`,
    ).run('fk-charge-item', 'clinic-v2-001', now, now)).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => freshDb.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'missing-order', 'Item', 1, 100, 100)`,
    ).run('fk-purchase-item', 'clinic-v2-001', now, now)).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => freshDb.prepare(
      `INSERT INTO InventoryTransaction (
         id, clinicId, createdAt, updatedAt, deletedAt,
         itemId, type, quantity
       ) VALUES (?, ?, ?, ?, NULL, 'missing-item', 'IN', 1)`,
    ).run('fk-inventory-tx', 'clinic-v2-001', now, now)).toThrow(/FOREIGN KEY constraint failed/);
    expect(() => freshDb.prepare(
      `INSERT INTO ProcessingOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, patientId, factoryId
       ) VALUES (?, ?, ?, ?, NULL, 'PO-FK', 'missing-patient', 'missing-factory')`,
    ).run('fk-processing', 'clinic-v2-001', now, now)).toThrow(/FOREIGN KEY constraint failed/);
    freshDb.prepare('DELETE FROM schema_migrations WHERE version = ?').run('116');
    runMigrations(freshDb);
    freshDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('repairs legacy constraint-violating rows before rebuilding core tables (C1)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-dirty-'));
    const dirtyDb = createDatabase(dir);
    const now = new Date().toISOString();

    // Valid referents for FK checks.
    dirtyDb.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'P-DIRTY', 'Dirty Patient', 'UNKNOWN', '13000000001',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('dirty-patient', 'clinic-dirty', now, now);
    dirtyDb.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, patientId, totalAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'CH-DIRTY', 'dirty-patient', 100, 'UNPAID')`,
    ).run('dirty-charge', 'clinic-dirty', now, now);

    // Dirty: negative balances on MemberCard.
    dirtyDb.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, 'dirty-patient', 'CARD-NEG', -100, -50, -25, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('mc-neg', 'clinic-dirty', now, now);
    // Dirty: duplicate cardNo (one soft-deleted so the pre-116 partial unique index passes).
    dirtyDb.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, '2026-01-01T00:00:00.000Z', 'dirty-patient', 'CARD-DUP', 0, 0, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('mc-dup-old', 'clinic-dirty', now, now);
    dirtyDb.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, 'dirty-patient', 'CARD-DUP', 5, 5, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('mc-dup-new', 'clinic-dirty', now, now);

    // Dirty: Refund with amount <= 0.
    dirtyDb.prepare(
      `INSERT INTO Refund (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, amount, reason
       ) VALUES (?, ?, ?, ?, NULL, 'dirty-charge', 'dirty-patient', 0, 'zero amount')`,
    ).run('rf-zero', 'clinic-dirty', now, now);
    // Dirty: Refund with NOT NULL orphan FK (chargeId missing) -> quarantine.
    dirtyDb.prepare(
      `INSERT INTO Refund (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, amount, reason
       ) VALUES (?, ?, ?, ?, NULL, 'missing-charge', 'dirty-patient', 50, 'orphan')`,
    ).run('rf-orphan', 'clinic-dirty', now, now);
    // Dirty: Refund with nullable orphan FK (operatorId missing) -> set NULL.
    dirtyDb.prepare(
      `INSERT INTO Refund (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, amount, operatorId, reason
       ) VALUES (?, ?, ?, ?, NULL, 'dirty-charge', 'dirty-patient', 50, 'missing-user', 'nullable orphan')`,
    ).run('rf-op-orphan', 'clinic-dirty', now, now);

    // Dirty: ChargeItem with invalid numeric fields.
    dirtyDb.prepare(
      `INSERT INTO ChargeItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, name, category, price, quantity, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'dirty-charge', 'Item', 'EXAM', -1, 0, -9)`,
    ).run('ci-bad', 'clinic-dirty', now, now);

    // Dirty: ProcessingOrder with illegal status.
    dirtyDb.prepare(
      `INSERT INTO ProcessingOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, patientId, status, totalFee
       ) VALUES (?, ?, ?, ?, NULL, 'PO-BAD', 'dirty-patient', 'BOGUS', 0)`,
    ).run('po-bad', 'clinic-dirty', now, now);
    // Dirty: duplicate ProcessingOrder number (one soft-deleted).
    dirtyDb.prepare(
      `INSERT INTO ProcessingOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, patientId, status, totalFee
       ) VALUES (?, ?, ?, ?, '2026-01-01T00:00:00.000Z', 'dirty-patient', 'PO-DUP', 'SENT', 0)`,
    ).run('po-dup-old', 'clinic-dirty', now, now);
    dirtyDb.prepare(
      `INSERT INTO ProcessingOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, patientId, status, totalFee
       ) VALUES (?, ?, ?, ?, NULL, 'dirty-patient', 'PO-DUP', 'SENT', 0)`,
    ).run('po-dup-new', 'clinic-dirty', now, now);

    // Dirty: InventoryTransaction with NOT NULL orphan FK (itemId missing) -> quarantine.
    dirtyDb.prepare(
      `INSERT INTO InventoryTransaction (
         id, clinicId, createdAt, updatedAt, deletedAt,
         itemId, type, quantity
       ) VALUES (?, ?, ?, ?, NULL, 'missing-item', 'IN', 1)`,
    ).run('it-orphan', 'clinic-dirty', now, now);

    // Must not throw despite the dirty data.
    expect(() => runMigrations(dirtyDb)).not.toThrow();

    // Numeric clamps applied.
    const mcNeg = dirtyDb.prepare(
      'SELECT balance, totalRecharge, totalConsume FROM MemberCard WHERE id = ?',
    ).get('mc-neg') as { balance: number; totalRecharge: number; totalConsume: number };
    expect(mcNeg.balance).toBe(0);
    expect(mcNeg.totalRecharge).toBe(0);
    expect(mcNeg.totalConsume).toBe(0);
    const rfZero = dirtyDb.prepare('SELECT amount FROM Refund WHERE id = ?').get('rf-zero') as { amount: number };
    expect(rfZero.amount).toBe(1);
    const ciBad = dirtyDb.prepare(
      'SELECT price, quantity, subtotal FROM ChargeItem WHERE id = ?',
    ).get('ci-bad') as { price: number; quantity: number; subtotal: number };
    expect(ciBad.price).toBe(0);
    expect(ciBad.quantity).toBe(1);
    expect(ciBad.subtotal).toBe(0);
    const poBad = dirtyDb.prepare('SELECT status FROM ProcessingOrder WHERE id = ?').get('po-bad') as { status: string };
    expect(poBad.status).toBe('SENT');

    // Unique keys deduplicated.
    const dupCards = dirtyDb.prepare(
      'SELECT clinicId, cardNo FROM MemberCard GROUP BY clinicId, cardNo HAVING COUNT(*) > 1',
    ).all();
    expect(dupCards).toHaveLength(0);
    const dupOrders = dirtyDb.prepare(
      'SELECT clinicId, number FROM ProcessingOrder GROUP BY clinicId, number HAVING COUNT(*) > 1',
    ).all();
    expect(dupOrders).toHaveLength(0);

    // Orphan FKs: nullable -> NULL, NOT NULL -> quarantined (row removed from source table).
    const rfOp = dirtyDb.prepare('SELECT operatorId FROM Refund WHERE id = ?').get('rf-op-orphan') as {
      operatorId: string | null;
    };
    expect(rfOp.operatorId).toBeNull();
    expect(dirtyDb.prepare('SELECT id FROM Refund WHERE id = ?').get('rf-orphan')).toBeUndefined();
    expect(dirtyDb.prepare('SELECT id FROM InventoryTransaction WHERE id = ?').get('it-orphan')).toBeUndefined();

    // Repair log exists and has records; quarantine holds the removed rows.
    const logTable = dirtyDb.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'MigrationRepairLog'",
    ).get();
    expect(logTable).toBeDefined();
    const logCount = (dirtyDb.prepare('SELECT COUNT(*) AS n FROM MigrationRepairLog').get() as { n: number }).n;
    expect(logCount).toBeGreaterThan(0);
    const quarantineCount = (dirtyDb.prepare('SELECT COUNT(*) AS n FROM MigrationRepairQuarantine').get() as { n: number }).n;
    expect(quarantineCount).toBeGreaterThanOrEqual(2);

    dirtyDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('refuses to rewrite a table when the foreign-key DDL would drop columns', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-fk-guard-'));
    const freshDb = createDatabase(dir);
    freshDb.exec('ALTER TABLE ChargeItem ADD COLUMN legacyExtra TEXT');
    expect(() => runMigrations(freshDb)).toThrow(/would drop columns: legacyExtra/);
    freshDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('backfills NULL clinicId rows to the earliest clinic and is idempotent (121)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-121-'));
    const freshDb = createDatabase(dir);
    const now = new Date().toISOString();
    const migrate121 = migrations.find((migration) => migration.version === 121);
    expect(migrate121).toBeDefined();

    // 无 Clinic 数据：跳过回填，不抛错。
    expect(() => migrate121!.up(freshDb)).not.toThrow();

    // 两个诊所，最早的为回填目标。
    freshDb.prepare(
      `INSERT INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES ('clinic-early', NULL, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', NULL, 'EARLY', 'Early', 1)`,
    ).run();
    freshDb.prepare(
      `INSERT INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES ('clinic-late', NULL, ?, ?, NULL, 'LATE', 'Late', 1)`,
    ).run(now, now);
    freshDb.prepare(
      `INSERT INTO Patient (id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active)
       VALUES ('patient-null-121', NULL, ?, ?, NULL, 'P-NULL-121', 'Null Patient', 'UNKNOWN', '13000000002',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run(now, now);
    freshDb.prepare(
      `INSERT INTO Charge (id, clinicId, createdAt, updatedAt, deletedAt,
         number, patientId, totalAmount, status)
       VALUES ('charge-null-121', NULL, ?, ?, NULL, 'CH-NULL-121', 'patient-null-121', 100, 'UNPAID')`,
    ).run(now, now);

    migrate121!.up(freshDb);
    const patientClinic = (freshDb.prepare('SELECT clinicId FROM Patient WHERE id = ?').get('patient-null-121') as {
      clinicId: string | null;
    }).clinicId;
    const chargeClinic = (freshDb.prepare('SELECT clinicId FROM Charge WHERE id = ?').get('charge-null-121') as {
      clinicId: string | null;
    }).clinicId;
    expect(patientClinic).toBe('clinic-early');
    expect(chargeClinic).toBe('clinic-early');

    // 幂等：重复应用不抛错、数据不变。
    expect(() => migrate121!.up(freshDb)).not.toThrow();
    expect(patientClinic).toBe('clinic-early');

    freshDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('backs users off UserClinic membership before the earliest clinic (121)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-121-user-'));
    const freshDb = createDatabase(dir);
    const now = new Date().toISOString();
    const migrate121 = migrations.find((migration) => migration.version === 121);
    expect(migrate121).toBeDefined();

    // 先跑全量迁移：117 建 UserClinic 并 populate。
    freshDb.prepare(
      `INSERT INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES ('clinic-early', NULL, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', NULL, 'EARLY', 'Early', 1)`,
    ).run();
    freshDb.prepare(
      `INSERT INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES ('clinic-late', NULL, ?, ?, NULL, 'LATE', 'Late', 1)`,
    ).run(now, now);
    runMigrations(freshDb);

    // 两个 NULL clinicId 用户：一个有成员关系，一个没有。
    freshDb.prepare(
      `INSERT INTO User (id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion, lockedUntil)
       VALUES ('user-member-121', NULL, ?, ?, NULL, 'member-null-121', 'hash', 'Member', 'BOSS', 1, 0, 0, NULL)`,
    ).run(now, now);
    freshDb.prepare(
      `INSERT INTO User (id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion, lockedUntil)
       VALUES ('user-plain-121', NULL, ?, ?, NULL, 'plain-null-121', 'hash', 'Plain', 'BOSS', 1, 0, 0, NULL)`,
    ).run(now, now);
    freshDb.prepare(
      `INSERT INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES ('user-member-121', 'clinic-late', 'BOSS', ?, ?, NULL)`,
    ).run(now, now);

    migrate121!.up(freshDb);
    const memberClinic = (freshDb.prepare('SELECT clinicId FROM User WHERE id = ?').get('user-member-121') as {
      clinicId: string | null;
    }).clinicId;
    const plainClinic = (freshDb.prepare('SELECT clinicId FROM User WHERE id = ?').get('user-plain-121') as {
      clinicId: string | null;
    }).clinicId;
    expect(memberClinic).toBe('clinic-late');
    expect(plainClinic).toBe('clinic-early');
    // 迁移 117 填充的既有成员行不被改写。
    expect(
      (freshDb.prepare('SELECT COUNT(*) AS n FROM UserClinic').get() as { n: number }).n,
    ).toBeGreaterThanOrEqual(1);

    freshDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('backfills UserClinic membership rows from User.clinicId (123)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-123-'));
    const freshDb = createDatabase(dir);
    const now = new Date().toISOString();
    const migrate117 = migrations.find((migration) => migration.version === 117);
    const migrate123 = migrations.find((migration) => migration.version === 123);
    expect(migrate117).toBeDefined();
    expect(migrate123).toBeDefined();

    freshDb.prepare(
      `INSERT INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES ('clinic-123', NULL, ?, ?, NULL, 'C123', 'Clinic 123', 1)`,
    ).run(now, now);
    // 先建 UserClinic 表（等价于 117 建表但无用户可回填）。
    migrate117!.up(freshDb);
    // 三个用户：无成员行、已有活跃成员行、clinicId 为 NULL。
    freshDb.prepare(
      `INSERT INTO User (id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion, lockedUntil)
       VALUES ('user-123-a', 'clinic-123', ?, ?, NULL, 'u123a', 'hash', 'A', 'DOCTOR', 1, 0, 0, NULL)`,
    ).run(now, now);
    freshDb.prepare(
      `INSERT INTO User (id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion, lockedUntil)
       VALUES ('user-123-b', 'clinic-123', ?, ?, NULL, 'u123b', 'hash', 'B', 'BOSS', 1, 0, 0, NULL)`,
    ).run(now, now);
    freshDb.prepare(
      `INSERT INTO User (id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion, lockedUntil)
       VALUES ('user-123-null', NULL, ?, ?, NULL, 'u123n', 'hash', 'N', 'BOSS', 1, 0, 0, NULL)`,
    ).run(now, now);
    freshDb.prepare(
      `INSERT INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES ('user-123-b', 'clinic-123', 'BOSS', ?, ?, NULL)`,
    ).run(now, now);

    expect(() => migrate123!.up(freshDb)).not.toThrow();

    const backfilled = freshDb.prepare(
      'SELECT userId, clinicId, role, deletedAt FROM UserClinic WHERE userId = ?',
    ).get('user-123-a') as { userId: string; clinicId: string; role: string; deletedAt: string | null };
    expect(backfilled).toBeDefined();
    expect(backfilled.clinicId).toBe('clinic-123');
    expect(backfilled.role).toBe('DOCTOR'); // 取自 User.role
    expect(backfilled.deletedAt).toBeNull();
    // 已有活跃成员行不被改写/重复。
    expect(
      (freshDb.prepare('SELECT COUNT(*) AS n FROM UserClinic WHERE userId = ?').get('user-123-b') as { n: number }).n,
    ).toBe(1);
    // clinicId 为 NULL 的用户不补成员行。
    expect(freshDb.prepare('SELECT 1 FROM UserClinic WHERE userId = ?').get('user-123-null')).toBeUndefined();
    // 幂等：再跑一次不新增。
    expect(() => migrate123!.up(freshDb)).not.toThrow();
    expect(
      (freshDb.prepare('SELECT COUNT(*) AS n FROM UserClinic WHERE userId = ?').get('user-123-a') as { n: number }).n,
    ).toBe(1);
    // 防御分支：老库无 UserClinic 表时跳过不抛错。
    freshDb.exec('DROP TABLE IF EXISTS UserClinic');
    expect(() => migrate123!.up(freshDb)).not.toThrow();

    freshDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('dedups NULL-clinic duplicate cardNo rows before migration 121 backfill (T2R-03)', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-121-dup-'));
    const db = createDatabase(dir);
    const now = new Date().toISOString();
    // 最早诊所（121 的回填目标）。
    db.prepare(
      `INSERT INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES ('clinic-early', NULL, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z', NULL, 'EARLY', 'Early', 1)`,
    ).run();
    // MemberCard.patientId 为 NOT NULL 外键，先建患者。
    db.prepare(
      `INSERT INTO Patient (id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active)
       VALUES ('patient-mc-dup', NULL, ?, ?, NULL, 'P-MC-DUP', 'Dup Patient', 'UNKNOWN', '13000000003',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run(now, now);
    // 两行 clinicId NULL、cardNo 相同 —— 121 回填后必撞唯一索引。
    db.prepare(
      `INSERT INTO MemberCard (id, clinicId, createdAt, updatedAt, deletedAt, patientId, cardNo,
         balance, totalRecharge, totalConsume, status, points, totalPoints, level)
       VALUES ('mc-dup-1', NULL, ?, ?, NULL, 'patient-mc-dup', 'CARD-1', 0, 0, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO MemberCard (id, clinicId, createdAt, updatedAt, deletedAt, patientId, cardNo,
         balance, totalRecharge, totalConsume, status, points, totalPoints, level)
       VALUES ('mc-dup-2', NULL, ?, ?, NULL, 'patient-mc-dup', 'CARD-1', 0, 0, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run(now, now);

    // 全量迁移（118 建唯一索引、121 回填）不抛错。
    expect(() => runMigrations(db)).not.toThrow();

    const rows = db.prepare(`SELECT id, clinicId, cardNo FROM MemberCard ORDER BY id`).all() as Array<{
      id: string; clinicId: string | null; cardNo: string;
    }>;
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.clinicId).toBe('clinic-early');
    const cardNos = rows.map((row) => row.cardNo);
    expect(new Set(cardNos).size).toBe(2);
    expect(cardNos).toContain('CARD-1');
    expect(cardNos.some((cardNo) => cardNo.startsWith('CARD-1-dup-'))).toBe(true);
    // 修复留痕。
    const logs = db.prepare(
      `SELECT * FROM MigrationRepairLog WHERE tableName = 'MemberCard' AND field = 'cardNo'`,
    ).all() as Array<{ beforeValue: string; afterValue: string }>;
    expect(logs.length).toBeGreaterThanOrEqual(1);
    expect(logs[0].beforeValue).toBe('CARD-1');
    // 幂等：再跑一遍不抛错、数据不变。
    expect(() => runMigrations(db)).not.toThrow();
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
