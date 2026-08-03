import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import {
  AuthService,
  AuditService,
  BulkImportService,
  ChargeService,
  InventoryService,
  MemberCardService,
  PatientRiskService,
} from './services';
import { SqliteChargeRepository } from '../infrastructure/repositories/charge.repository';
import type { MemberCardRepository, MemberCardRecord } from './ports';
import type { AppContext } from '../../domain/contracts';

describe('application services', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-test-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test-trace',
      now: () => new Date(),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('creates, pays, and refunds a charge', async () => {
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: [{ name: 'Exam', category: 'EXAM', price: 100, quantity: 2 }],
    }, context);
    const paid = await service.pay(String(created.id), 200, 'CASH', undefined, context);
    expect(paid.status).toBe('PAID');
    const refunded = await service.refund(String(created.id), 50, 'adjustment', context);
    expect(refunded.amount).toBe(50);
  });

  it('applies a discount when creating a charge', async () => {
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: [{ name: 'Exam', category: 'EXAM', price: 200, quantity: 1 }],
      discount: 50,
    }, context);
    expect(created.totalAmount).toBe(150);
    const row = db.prepare('SELECT totalAmount, discount FROM Charge WHERE id = ?').get(String(created.id)) as {
      totalAmount: number;
      discount: number;
    };
    expect(row.totalAmount).toBe(150);
    expect(row.discount).toBe(50);
  });

  it('rejects a stock decrease below zero', async () => {
    const service = new InventoryService(db);
    await expect(
      service.createTransaction({ itemId: 'inventory-demo-001', type: 'OUT', quantity: 10_000 }, context),
    ).rejects.toThrow('Insufficient stock');
  });

  it('recharges and consumes from a member card', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-TEST', 0, 0, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-test', context.clinicId, now, now, 'patient-demo-001');
    const service = new MemberCardService(db);
    await service.recharge('card-test', 1000, context);
    await service.consume('card-test', 300, context);
    await service.addPoints('card-test', 20, context);
    const card = db.prepare('SELECT * FROM MemberCard WHERE id = ?').get('card-test') as Record<string, unknown>;
    expect(Number(card.balance)).toBe(700);
    expect(Number(card.points)).toBe(20);
  });

  it('deducts and refunds member card balance with a charge', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'CARD-P', 'Card Patient', 'UNKNOWN', '13000000000',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-card-refund', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-REFUND', 1000, 1000, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-refund-test', context.clinicId, now, now, 'patient-card-refund');
    const chargeService = new ChargeService(db);
    const created = await chargeService.create({
      patientId: 'patient-card-refund',
      items: [{ name: 'Implant', category: 'IMPLANT', price: 300, quantity: 1 }],
    }, context);
    await chargeService.pay(String(created.id), 300, 'MEMBER_CARD', undefined, context);
    let card = db.prepare('SELECT * FROM MemberCard WHERE id = ?').get('card-refund-test') as Record<string, unknown>;
    expect(Number(card.balance)).toBe(700);
    await chargeService.refund(String(created.id), 100, 'adjustment', context);
    card = db.prepare('SELECT * FROM MemberCard WHERE id = ?').get('card-refund-test') as Record<string, unknown>;
    expect(Number(card.balance)).toBe(800);
  });

  it('calculates a patient risk score', () => {
    const service = new PatientRiskService(db);
    const result = service.calculate('patient-demo-001', context);
    expect(result).toHaveProperty('cariesScore');
    expect(result).toHaveProperty('periodontalScore');
  });

  it('bulk imports patients', async () => {
    const service = new BulkImportService(db);
    const result = await service.importRows('patients', [
      { code: 'BULK-001', name: 'Bulk Patient', gender: 'UNKNOWN', phone: '13700000001', source: 'OTHER' },
    ], context);
    expect(result.imported).toBe(1);
  });

  it('rolls back charge payment when member card deduction fails', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'ROLLBACK-P', 'Rollback Patient', 'UNKNOWN', '13100000000',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-rollback', context.clinicId, now, now);
    const card: MemberCardRecord = {
      id: 'card-rollback',
      clinicId: context.clinicId,
      patientId: 'patient-rollback',
      cardNo: 'CARD-ROLLBACK',
      balance: 1000,
      totalRecharge: 1000,
      totalConsume: 0,
      points: 0,
      totalPoints: 0,
      status: 'ACTIVE',
      level: 'NORMAL',
      createdAt: now,
      updatedAt: now,
    };
    const failingMemberRepository: MemberCardRepository = {
      findById: () => card,
      findByPatient: () => card,
      updateBalanceRefund: () => {},
      updateRecharge: () => {},
      updateConsume: () => { throw new Error('member card failure'); },
      updatePoints: () => {},
      insertLog: () => {},
      insertPointLog: () => {},
    };
    const service = new ChargeService(
      db,
      new SqliteChargeRepository(db),
      failingMemberRepository,
    );
    const created = await service.create({
      patientId: 'patient-rollback',
      items: [{ name: 'Exam', category: 'EXAM', price: 200, quantity: 1 }],
    }, context);
    await expect(service.pay(String(created.id), 200, 'MEMBER_CARD', undefined, context))
      .rejects.toThrow('member card failure');
    const charge = db.prepare('SELECT * FROM Charge WHERE id = ?').get(String(created.id)) as Record<string, unknown>;
    expect(Number(charge.paidAmount)).toBe(0);
    expect(charge.status).toBe('UNPAID');
  });

  it('rotates refresh tokens and rejects reused tokens', async () => {
    const service = new AuthService(db);
    const session = await service.login('admin', 'REDACTED');
    expect(session.refreshToken).toBeDefined();
    const refreshed = await service.refresh(session.refreshToken);
    expect(refreshed.refreshToken).not.toBe(session.refreshToken);
    await expect(service.refresh(session.refreshToken)).rejects.toThrow('Invalid refresh token');
    await service.logout(refreshed.refreshToken);
    await expect(service.refresh(refreshed.refreshToken)).rejects.toThrow('Invalid refresh token');
  });

  it('writes operation log entries', () => {
    const audit = new AuditService(db);
    audit.log({
      userId: 'user-admin-001',
      action: 'TEST_WRITE',
      target: 'target-1',
      traceId: 'trace-audit',
      clinicId: 'clinic-v2-001',
    });
    const row = db.prepare('SELECT * FROM OperationLog WHERE target = ?').get('target-1') as Record<string, unknown>;
    expect(row.action).toBe('TEST_WRITE');
    expect(row.traceId).toBe('trace-audit');
  });
});
