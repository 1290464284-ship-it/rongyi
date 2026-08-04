import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from './database';
import { migrations, runMigrations } from './migrations';

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
    expect(memberFk.length).toBeGreaterThan(0);
    expect(refundFk.length).toBeGreaterThan(0);
    expect(chargeItemFk.length).toBeGreaterThan(0);
    expect(purchaseItemFk.length).toBeGreaterThan(0);
    expect(inventoryTxFk.length).toBeGreaterThan(0);
    expect(processingFk.length).toBeGreaterThan(0);

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

  it('refuses to rewrite a table when the foreign-key DDL would drop columns', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-mig-fk-guard-'));
    const freshDb = createDatabase(dir);
    freshDb.exec('ALTER TABLE ChargeItem ADD COLUMN legacyExtra TEXT');
    expect(() => runMigrations(freshDb)).toThrow(/would drop columns: legacyExtra/);
    freshDb.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
