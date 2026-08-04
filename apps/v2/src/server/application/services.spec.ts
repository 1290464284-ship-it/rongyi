import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import {
  AppointmentService,
  AuthService,
  AuditService,
  BulkImportService,
  ChargeService,
  FollowUpService,
  InventoryService,
  MemberCardService,
  PatientRiskService,
} from './services';
import { SqliteChargeRepository } from '../infrastructure/repositories/charge.repository';
import type { AuthRepository, MemberCardRepository, MemberCardRecord } from './ports';
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

  it('rejects missing patients and keeps appointment conflicts clinic-scoped', async () => {
    const appointments = new AppointmentService(db);
    const charges = new ChargeService(db);
    const memberCards = new MemberCardService(db);
    const risk = new PatientRiskService(db);
    const startTime = new Date(Date.now() + 5 * 86_400_000).toISOString();
    const endTime = new Date(Date.now() + 5 * 86_400_000 + 3_600_000).toISOString();

    await expect(appointments.create({
      patientId: 'missing-patient-audit',
      doctorId: 'user-admin-001',
      startTime,
      endTime,
      type: 'REGULAR',
    }, context)).rejects.toMatchObject({ status: 404 });
    await expect(charges.create({
      patientId: 'missing-patient-audit',
      items: [{ name: 'Exam', category: 'EXAM', price: 100, quantity: 1 }],
    }, context)).rejects.toMatchObject({ status: 404 });
    expect(() => memberCards.create({
      patientId: 'missing-patient-audit',
      cardNo: 'CARD-MISSING-PATIENT',
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context)).toThrow('Patient not found');
    expect(() => risk.calculate('missing-patient-audit', context)).toThrow('Patient not found');

    const now = new Date().toISOString();
    const otherClinicStart = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const otherClinicEnd = new Date(Date.now() + 30 * 86_400_000 + 3_600_000).toISOString();
    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, chairId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('appointment-other-clinic-audit', 'clinic-v2-002', now, now, 'patient-demo-001', 'user-admin-001', 'chair-audit', otherClinicStart, otherClinicEnd);

    await expect(appointments.create({
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      chairId: 'chair-audit',
      startTime: otherClinicStart,
      endTime: otherClinicEnd,
      type: 'REGULAR',
    }, context)).resolves.toHaveProperty('id');
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

  it('rejects member card operations when the card is not active', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'INACTIVE-CARD-P', 'Inactive Card Patient', 'UNKNOWN', '13300000000',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-inactive-card', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-INACTIVE-TEST', 100, 100, 0, 'INACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-inactive-test', context.clinicId, now, now, 'patient-inactive-card');
    const service = new MemberCardService(db);
    await expect(service.recharge('card-inactive-test', 10, context)).rejects.toThrow('not active');
    await expect(service.consume('card-inactive-test', 10, context)).rejects.toThrow('not active');
    await expect(service.addPoints('card-inactive-test', 10, context)).rejects.toThrow('not active');
  });

  it('rejects globally duplicate member card numbers', () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'DUP-CARD-B', 'Duplicate Card Patient B', 'UNKNOWN', '13300000001',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-dup-card-b', 'clinic-v2-002', now, now);
    const service = new MemberCardService(db);
    service.create({
      patientId: 'patient-demo-001',
      cardNo: 'CARD-DUP-GLOBAL',
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context);
    expect(() => service.create({
      patientId: 'patient-dup-card-b',
      cardNo: 'CARD-DUP-GLOBAL',
      status: 'ACTIVE',
      level: 'NORMAL',
    }, { ...context, clinicId: 'clinic-v2-002' })).toThrow('already exists');
  });

  it('maps member-card create unique races to conflict errors', () => {
    const repo = {
      create: () => { throw new Error('UNIQUE constraint failed: MemberCard.cardNo'); },
    } as unknown as MemberCardRepository;
    const service = new MemberCardService(db, repo);
    expect(() => service.create({
      patientId: 'patient-demo-001',
      cardNo: 'CARD-CATCH-UNIQUE',
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context)).toThrow('already exists');
  });

  it('rethrows non-unique member-card create failures', () => {
    const repo = {
      create: () => { throw new Error('database down'); },
    } as unknown as MemberCardRepository;
    const service = new MemberCardService(db, repo);
    expect(() => service.create({
      patientId: 'patient-demo-001',
      cardNo: 'CARD-CATCH-DOWN',
      status: 'ACTIVE',
      level: 'NORMAL',
    }, context)).toThrow('database down');
  });

  it('fails a member-card refund when the card has been deleted', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'DELETED-CARD-P', 'Deleted Card Patient', 'UNKNOWN', '13300000002',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-deleted-card-refund', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-DELETED-REFUND', 500, 500, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-deleted-refund', context.clinicId, now, now, 'patient-deleted-card-refund');
    const charges = new ChargeService(db);
    const created = await charges.create({
      patientId: 'patient-deleted-card-refund',
      items: [{ name: 'Implant', category: 'IMPLANT', price: 200, quantity: 1 }],
    }, context);
    await charges.pay(String(created.id), 200, 'MEMBER_CARD', undefined, context);
    db.prepare('UPDATE MemberCard SET deletedAt = ? WHERE id = ?').run(now, 'card-deleted-refund');
    await expect(charges.refund(String(created.id), 50, 'deleted card', context)).rejects.toThrow('Member card used for payment is not found');
  });

  it('refunds legacy member-card charges without a recorded card id', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'LEGACY-CARD-P', 'Legacy Card Patient', 'UNKNOWN', '13300000003',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-legacy-card-refund', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-LEGACY-REFUND', 500, 500, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-legacy-refund', context.clinicId, now, now, 'patient-legacy-card-refund');
    const charges = new ChargeService(db);
    const created = await charges.create({
      patientId: 'patient-legacy-card-refund',
      items: [{ name: 'Implant', category: 'IMPLANT', price: 200, quantity: 1 }],
    }, context);
    await charges.pay(String(created.id), 200, 'MEMBER_CARD', undefined, context);
    db.prepare('UPDATE Charge SET memberCardId = NULL WHERE id = ?').run(String(created.id));
    await charges.refund(String(created.id), 50, 'legacy refund', context);
    const card = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get('card-legacy-refund') as { balance: number };
    expect(Number(card.balance)).toBe(350);
  });

  it('dedupes follow-up generation when no templates exist', async () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    db.prepare('DELETE FROM FollowUpTemplate').run();
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', ?, ?, 'COMPLETED')`,
    ).run('visit-followup-null-template', context.clinicId, now, now, now, now);
    db.prepare(
      `INSERT INTO Treatment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, code, name, category,
         price, quantity, status, completedDate
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'user-admin-001', 'T-NULL', 'T', 'GENERAL', 100, 1, 'COMPLETED', ?)`,
    ).run('treatment-followup-null-template', context.clinicId, now, now, 'visit-followup-null-template', now.slice(0, 10));
    const first = await service.batchGenerate(2, context);
    expect(first.generated).toBeGreaterThanOrEqual(1);
    const second = await service.batchGenerate(2, context);
    expect(second.generated).toBe(0);
  });

  it('rejects invalid completed dates during follow-up generation', async () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO FollowUpTemplate (
         id, clinicId, createdAt, updatedAt, deletedAt,
         name, daysAfter, content, isEnabled
       ) VALUES (?, ?, ?, ?, NULL, 'Bad Date Template', 1, 'bad date', 1)`,
    ).run('template-bad-date', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', ?, ?, 'COMPLETED')`,
    ).run('visit-followup-bad-date', context.clinicId, now, now, now, now);
    db.prepare(
      `INSERT INTO Treatment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, code, name, category,
         price, quantity, status, completedDate
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'user-admin-001', 'T-BAD', 'T', 'GENERAL', 100, 1, 'COMPLETED', 'not-a-date')`,
    ).run('treatment-followup-bad-date', context.clinicId, now, now, 'visit-followup-bad-date');
    await expect(service.batchGenerate(2, context)).rejects.toThrow('Completed date is invalid');
  });

  it('completes follow-ups with clinic scope and status checks', () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Complete me', 'PENDING')`,
    ).run('followup-complete', context.clinicId, now, now, now.slice(0, 10));
    expect(service.complete('followup-complete', context)).toMatchObject({ id: 'followup-complete', status: 'COMPLETED' });
    expect(() => service.complete('followup-complete', context)).toThrow('cannot be completed from current status');

    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'In progress', 'IN_PROGRESS')`,
    ).run('followup-in-progress', context.clinicId, now, now, now.slice(0, 10));
    expect(service.complete('followup-in-progress', context).status).toBe('COMPLETED');

    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'With result', 'PENDING')`,
    ).run('followup-result', context.clinicId, now, now, now.slice(0, 10));
    expect(service.complete('followup-result', context, ' 已回访 ')).toMatchObject({
      id: 'followup-result',
      status: 'COMPLETED',
      result: '已回访',
    });

    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Long result', 'PENDING')`,
    ).run('followup-long-result', context.clinicId, now, now, now.slice(0, 10));
    expect(() => service.complete('followup-long-result', context, 'x'.repeat(501)))
      .toThrow('at most 500 characters');

    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Other clinic', 'PENDING')`,
    ).run('followup-other-clinic', 'clinic-v2-other', now, now, now.slice(0, 10));
    expect(() => service.complete('followup-other-clinic', context)).toThrow('Follow-up not found');
    expect(() => service.complete('missing-followup', context)).toThrow('Follow-up not found');

    const failingRepository = new FollowUpService(db, {
      reminders: () => [],
      insert: () => undefined,
      complete: () => 0,
    });
    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'Race guard', 'PENDING')`,
    ).run('followup-race-guard', context.clinicId, now, now, now.slice(0, 10));
    expect(() => failingRepository.complete('followup-race-guard', context)).toThrow('cannot be completed');
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
      create: () => {},
      findById: () => card,
      findByPatient: () => card,
      findByPatientForRefund: () => card,
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
    const session = await service.login('admin', 'admin123');
    expect(session.refreshToken).toBeDefined();
    const refreshed = await service.refresh(session.refreshToken);
    expect(refreshed.refreshToken).not.toBe(session.refreshToken);
    await expect(service.refresh(session.refreshToken)).rejects.toThrow('Invalid refresh token');
    await service.logout(refreshed.refreshToken);
    await expect(service.refresh(refreshed.refreshToken)).rejects.toThrow('Invalid refresh token');
  });

  it('maps create-user unique races to conflict errors', async () => {
    const repo = {
      findByUsername: () => null,
      insertUser: () => { throw new Error('UNIQUE constraint failed: User.username'); },
    } as unknown as AuthRepository;
    const auth = new AuthService(db, repo);
    await expect(auth.createUser({
      username: 'race-user',
      password: 'password123',
      name: 'Race User',
      role: 'DOCTOR',
    }, context)).rejects.toThrow('Username already exists');
  });

  it('rethrows non-unique create-user repository failures', async () => {
    const repo = {
      findByUsername: () => null,
      insertUser: () => { throw new Error('database down'); },
    } as unknown as AuthRepository;
    const auth = new AuthService(db, repo);
    await expect(auth.createUser({
      username: 'down-user',
      password: 'password123',
      name: 'Down User',
      role: 'DOCTOR',
    }, context)).rejects.toThrow('database down');
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

  it('rejects user updates when the repository reports zero affected rows', async () => {
    const fakeAuth = {
      findById: () => ({
        id: 'user-1',
        clinicId: 'clinic-v2-001',
        username: 'u',
        passwordHash: 'hash',
        name: 'n',
        role: 'BOSS',
        active: true,
        loginAttempts: 0,
        lockedUntil: null,
        tokenVersion: 0,
        refreshToken: null,
        refreshTokenExpiresAt: null,
        createdAt: '2026-08-04T00:00:00.000Z',
        updatedAt: '2026-08-04T00:00:00.000Z',
        deletedAt: null,
      }),
      updateUser: () => 0,
      resetPassword: () => 0,
    } as unknown as AuthRepository;
    const service = new AuthService(db, fakeAuth);
    await expect(service.updateUser('user-1', { name: 'x' }, context)).rejects.toThrow('User not found');
    await expect(service.resetPassword('user-1', 'password123', context)).rejects.toThrow('User not found');
  });
});
