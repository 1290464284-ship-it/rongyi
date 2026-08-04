import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type Database from 'better-sqlite3';
import DatabaseClass from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../infrastructure/database';
import { runMigrations } from '../infrastructure/migrations';
import {
  AlertService,
  AppointmentService,
  AuditService,
  AuthService,
  BackupService,
  BulkImportService,
  CephalometricService,
  ChargeService,
  DebtService,
  FollowUpService,
  HrService,
  InventoryService,
  MemberCardService,
  NotificationService,
  PatientRiskService,
  PrescriptionSafetyService,
  PrintService,
  ProcessingOrderService,
  PurchaseOrderService,
  SatisfactionService,
  SearchService,
  StatsService,
  SyncService,
  TreatmentProgressService,
} from './services';
import {
  AnalyticsService,
  ChargeAssistantService,
  ClinicalWorkflowService,
  PrintTemplateService,
  ReplenishmentService,
  WechatService,
} from './workflow-services';
import type { AuthRepository } from './ports';
import type { AppContext } from '../../domain/contracts';

interface TokenPayload {
  sub: string;
  clinicId: string | null;
  role: string;
  tokenVersion: number;
}

describe('service edge coverage', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  let nullContext: AppContext;
  const now = '2026-08-04T00:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-service-edge-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(),
    };
    nullContext = {
      userId: 'user-admin-001',
      clinicId: null,
      role: 'BOSS',
      traceId: 'trace-null',
      now: () => new Date(),
    };
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertUser(id: string, overrides: Record<string, unknown> = {}): void {
    const merged = {
      id,
      clinicId: 'clinic-v2-001',
      createdAt: now,
      updatedAt: now,
      username: `user-${id}`,
      passwordHash: '$2a$10$7EqJtq98hPqEX7fNZaFWoOhi4J7BQj2rC1s6s5n9oJ3l6dL6J9t1e',
      name: `User ${id}`,
      role: 'BOSS',
      active: 1,
      loginAttempts: 0,
      tokenVersion: 0,
      lockedUntil: null,
      ...overrides,
    };
    db.prepare(
      `INSERT OR REPLACE INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion,
         lockedUntil
       ) VALUES (
         @id, @clinicId, @createdAt, @updatedAt, NULL,
         @username, @passwordHash, @name, @role, @active, @loginAttempts, @tokenVersion,
         @lockedUntil
       )`,
    ).run(merged);
  }

  it('covers auth login, refresh, logout, me, and password branches', async () => {
    const auth = new AuthService(db);
    insertUser('edge-disabled', { active: 0 });
    await expect(auth.login('user-edge-disabled', 'REDACTED')).rejects.toThrow('disabled');
    insertUser('edge-locked', { lockedUntil: new Date(Date.now() + 60_000).toISOString() });
    await expect(auth.login('user-edge-locked', 'REDACTED')).rejects.toThrow('locked');
    insertUser('edge-lockout', { passwordHash: bcrypt.hashSync('correct', 10) });
    for (let i = 0; i < 5; i += 1) {
      await expect(auth.login('user-edge-lockout', 'wrong')).rejects.toThrow();
    }

    await expect(auth.refresh('')).rejects.toThrow('Refresh token is required');
    await expect(auth.refresh('unknown')).rejects.toThrow('Invalid refresh token');
    const session = await auth.login('admin', 'REDACTED');
    const tokenPayload: TokenPayload = {
      sub: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      tokenVersion: 0,
    };
    db.prepare('UPDATE User SET tokenVersion = 1 WHERE id = ?').run('user-admin-001');
    await expect(auth.me(tokenPayload)).rejects.toThrow('Token is no longer valid');
    db.prepare('UPDATE User SET tokenVersion = 0 WHERE id = ?').run('user-admin-001');
    await expect(auth.me(tokenPayload)).resolves.toMatchObject({ username: 'admin' });

    await expect(auth.getUserById('missing-user')).rejects.toThrow('User not found');
    await expect(auth.changePassword('missing-user', 'x', 'newpass123')).rejects.toThrow('User not found');
    await expect(auth.changePassword('user-admin-001', 'wrong', 'newpass123')).rejects.toThrow('Old password is incorrect');
    await expect(auth.changePassword('user-admin-001', 'REDACTED', 'short')).rejects.toThrow('at least 8');

    await auth.logout('');
    await auth.logout('unknown-token');
    await auth.logout(session.refreshToken);

    await expect(auth.login('unknown-user', 'wrong')).rejects.toThrow('Invalid username or password');
    expect(() => auth.verifyToken('invalid-token')).toThrow('Invalid or expired token');

    insertUser('edge-refresh-disabled', { active: 0 });
    db.prepare('UPDATE User SET refreshToken = ?, refreshTokenExpiresAt = ? WHERE id = ?')
      .run(createHash('sha256').update('token-disabled').digest('hex'), new Date(Date.now() + 60_000).toISOString(), 'edge-refresh-disabled');
    await expect(auth.refresh('token-disabled')).rejects.toThrow('disabled');

    insertUser('edge-refresh-locked', { lockedUntil: new Date(Date.now() + 60_000).toISOString() });
    db.prepare('UPDATE User SET refreshToken = ?, refreshTokenExpiresAt = ? WHERE id = ?')
      .run(createHash('sha256').update('token-locked').digest('hex'), new Date(Date.now() + 60_000).toISOString(), 'edge-refresh-locked');
    await expect(auth.refresh('token-locked')).rejects.toThrow('locked');

    db.prepare('UPDATE User SET refreshToken = ?, refreshTokenExpiresAt = ? WHERE id = ?')
      .run(createHash('sha256').update('token-expired').digest('hex'), new Date(Date.now() - 60_000).toISOString(), 'user-admin-001');
    await expect(auth.refresh('token-expired')).rejects.toThrow('expired');

    insertUser('edge-null-clinic', {
      clinicId: null,
      loginAttempts: null,
      tokenVersion: null,
      passwordHash: bcrypt.hashSync('nullpass', 10),
    });
    const nullSession = await auth.login('user-edge-null-clinic', 'nullpass');
    expect(nullSession.user.clinicId).toBeNull();
    const nullRefreshed = await auth.refresh(nullSession.refreshToken);
    expect(nullRefreshed.user.clinicId).toBeNull();
    db.prepare('UPDATE User SET refreshTokenExpiresAt = NULL WHERE id = ?').run('edge-null-clinic');
    await expect(auth.refresh(nullRefreshed.refreshToken)).rejects.toThrow('expired');

    const mockAuthRepository = {
      findByUsername: () => ({
        id: 'mock-auth-user',
        clinicId: null,
        username: 'mock-auth',
        passwordHash: bcrypt.hashSync('mockpass', 10),
        name: 'Mock',
        role: 'BOSS',
        active: 1,
        loginAttempts: undefined,
        tokenVersion: undefined,
        createdAt: now,
        updatedAt: now,
      }),
      resetLoginAttempts: vi.fn(),
      updateRefreshToken: vi.fn(),
    } as unknown as AuthRepository;
    const mockAuth = new AuthService({} as Database.Database, mockAuthRepository);
    await expect(mockAuth.login('mock-auth', 'mockpass')).resolves.toBeDefined();
  });

  it('allows only BOSS to access multiple clinics and switch current clinic', async () => {
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'V2-2', 'Clinic 2', 1)`,
    ).run('clinic-v2-other', now, now);
    const auth = new AuthService(db);
    expect(() => auth.listAccessibleClinics('missing-user', 'BOSS')).toThrow('User not found');
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'V2-EMPTY', '', 1)`,
    ).run('clinic-v2-empty', now, now);
    const boss = await auth.createUser({
      username: 'boss-multi',
      password: 'password123',
      name: 'Boss Multi',
      role: 'BOSS',
      clinicIds: ['clinic-v2-001', 'clinic-v2-other'],
    }, context);
    const accessible = auth.listAccessibleClinics(boss.id, 'BOSS');
    expect(accessible.clinics).toHaveLength(2);
    const emptyNameBoss = await auth.createUser({
      username: 'boss-empty-name',
      password: 'password123',
      name: 'Boss Empty Name',
      role: 'BOSS',
      clinicIds: ['clinic-v2-empty'],
    }, context);
    expect(auth.listAccessibleClinics(emptyNameBoss.id, 'BOSS').clinics.some((clinic) => clinic.name === 'clinic-v2-empty')).toBe(true);
    expect(() => auth.switchClinic('missing-user', 'BOSS', 'clinic-v2-001')).toThrow('User not found');
    expect(() => auth.switchClinic(boss.id, 'BOSS', 'clinic-v2-missing')).toThrow('Clinic not found');
    const switched = auth.switchClinic(boss.id, 'BOSS', 'clinic-v2-other');
    expect(switched.clinicId).toBe('clinic-v2-other');
    expect((await auth.getUserById(boss.id)).currentClinicId).toBe('clinic-v2-other');
    db.prepare('DELETE FROM UserClinic WHERE userId = ?').run(boss.id);
    expect(auth.listAccessibleClinics(boss.id, 'BOSS').clinics).toHaveLength(1);
    await expect(auth.createUser({
      username: 'boss-bad-clinics',
      password: 'password123',
      name: 'Bad Clinics',
      role: 'BOSS',
      clinicIds: 'clinic-v2-001' as unknown as string[],
    }, context)).rejects.toThrow('clinicIds must be an array of strings');
    await expect(auth.createUser({
      username: 'boss-missing-clinic',
      password: 'password123',
      name: 'Missing Clinic',
      role: 'BOSS',
      clinicIds: ['clinic-v2-missing'],
    }, context)).rejects.toThrow('clinicIds must reference existing clinics');
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES ('clinic-v2-disabled', NULL, ?, ?, NULL, 'V2-DISABLED', 'Disabled Clinic', 0)`,
    ).run(now, now);
    db.prepare(
      `INSERT OR IGNORE INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES (?, 'clinic-v2-disabled', 'BOSS', ?, ?, NULL)`,
    ).run(boss.id, now, now);
    expect(() => auth.switchClinic(boss.id, 'BOSS', 'clinic-v2-disabled')).toThrow('Clinic not found');

    const nurse = await auth.createUser({
      username: 'nurse-single',
      password: 'password123',
      name: 'Nurse Single',
      role: 'NURSE',
      clinicIds: ['clinic-v2-other'],
    }, { ...context, clinicId: 'clinic-v2-001' });
    expect(auth.listAccessibleClinics(nurse.id, 'NURSE').clinics).toHaveLength(1);
    expect(() => auth.switchClinic(nurse.id, 'NURSE', 'clinic-v2-other')).toThrow('Only BOSS can switch clinics');

    const bossNull = await auth.createUser({
      username: 'boss-null-clinic',
      password: 'password123',
      name: 'Boss Null Clinic',
      role: 'BOSS',
    }, { ...context, clinicId: null });
    const nurseNull = await auth.createUser({
      username: 'nurse-null-clinic',
      password: 'password123',
      name: 'Nurse Null Clinic',
      role: 'NURSE',
    }, { ...context, clinicId: null });
    expect(auth.listAccessibleClinics(bossNull.id, 'BOSS').clinics).toEqual([]);
    expect(auth.listAccessibleClinics(nurseNull.id, 'NURSE')).toEqual({
      currentClinicId: null,
      clinics: [],
    });
  });

  it('covers audit logs with nullish optional fields', () => {
    const audit = new AuditService(db);
    audit.log({ action: 'EDGE_NULL' });
    const row = db.prepare("SELECT * FROM OperationLog WHERE action = 'EDGE_NULL'").get() as Record<string, unknown>;
    expect(row.userId).toBeNull();
    expect(row.traceId).toBeNull();
    expect(row.clinicId).toBeNull();
  });

  it('covers appointment validation and conflict branches', async () => {
    const service = new AppointmentService(db);
    const base = {
      patientId: 'patient-demo-001',
      doctorId: 'user-admin-001',
      startTime: new Date(Date.now() + 10 * 86_400_000).toISOString(),
      endTime: new Date(Date.now() + 10 * 86_400_000 + 3_600_000).toISOString(),
      type: 'REGULAR',
    };
    const created = await service.create({ ...base, chairId: 'chair-1', remark: 'r' }, context);
    await expect(service.transition('missing-appointment', 'ARRIVED', context)).rejects.toThrow('Appointment not found');
    await expect(service.transition(String(created.id), 'INVALID', context)).rejects.toThrow('Cannot transition');
    await expect(service.create({ ...base, startTime: 'bad', endTime: 'worse' }, context)).rejects.toThrow('endTime');
    await expect(service.create(base, context)).rejects.toThrow('already booked');
  });

  it('covers charge creation, payment, refund, member-card, and debt branches', async () => {
    const service = new ChargeService(db);
    await expect(service.create({ patientId: 'patient-demo-001', items: [] }, context)).rejects.toThrow('At least one');
    await expect(service.create({
      patientId: 'patient-demo-001',
      items: [{ name: 'X', category: 'EXAM', price: 100, quantity: 1 }],
      discount: -1,
    }, context)).rejects.toThrow('Discount');
    await expect(service.create({ patientId: '', items: [{ name: 'X', category: 'EXAM', price: 100, quantity: 1 }] }, context))
      .rejects.toThrow('patientId');
    await expect(service.create({ patientId: 'patient-demo-001', items: [{ name: '', category: '', price: 100, quantity: 1 }] }, context))
      .rejects.toThrow('name and category');
    await expect(service.create({ patientId: 'patient-demo-001', items: [{ name: 'X', category: 'EXAM', price: 0, quantity: 1 }] }, context))
      .rejects.toThrow('positive integer');
    await expect(service.create({ patientId: 'patient-demo-001', items: [{ name: 'X', category: 'EXAM', price: 100, quantity: 0 }] }, context))
      .rejects.toThrow('quantity must be positive');

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'EDGE-P', 'Edge Patient', 'UNKNOWN', '13600000001',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-edge', context.clinicId, now, now);
    const created = await service.create({
      patientId: 'patient-edge',
      visitId: 'visit-edge',
      doctorId: 'user-admin-001',
      items: [{ name: 'Exam', category: 'EXAM', price: 100, quantity: 1 }],
      remark: 'r',
    }, context);
    const chargeId = String(created.id);
    await expect(service.pay('missing-charge', 1, 'CASH', undefined, context)).rejects.toThrow('Charge not found');
    db.prepare('UPDATE Charge SET status = ? WHERE id = ?').run('CANCELLED', chargeId);
    await expect(service.pay(chargeId, 1, 'CASH', undefined, context)).rejects.toThrow('cannot be paid');
    db.prepare('UPDATE Charge SET status = ? WHERE id = ?').run('UNPAID', chargeId);
    await expect(service.pay(chargeId, 0, 'CASH', undefined, context)).rejects.toThrow('positive');
    const partial = await service.pay(chargeId, 40, 'CASH', undefined, context);
    expect(partial.status).toBe('PARTIAL');
    const paid = await service.pay(chargeId, 60, 'CASH', 'edge-pay-request', context);
    expect(paid.status).toBe('PAID');
    const duplicate = await service.pay(chargeId, 60, 'CASH', 'edge-pay-request', context);
    expect(duplicate.paidAmount).toBe(100);

    await expect(service.refund('missing-charge', 1, 'x', context)).rejects.toThrow('Charge not found');
    await expect(service.refund(chargeId, 0, 'x', context)).rejects.toThrow('Refund amount');
    const refunded = await service.refund(chargeId, 100, 'full', context);
    expect(refunded.status).toBe('REFUNDED');

    const memberCharge = await service.create({
      patientId: 'patient-edge',
      items: [{ name: 'Implant', category: 'IMPLANT', price: 200, quantity: 1 }],
    }, context);
    await expect(service.pay(String(memberCharge.id), 200, 'MEMBER_CARD', undefined, context)).rejects.toThrow('No active member card');

    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-EDGE', 50, 0, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-edge', context.clinicId, now, now, 'patient-edge');
    await expect(service.pay(String(memberCharge.id), 200, 'MEMBER_CARD', undefined, context)).rejects.toThrow('Insufficient member card');

    const debtCharge = await service.create({
      patientId: 'patient-edge',
      items: [{ name: 'Debt', category: 'EXAM', price: 500, quantity: 1 }],
    }, context);
    await service.pay(String(debtCharge.id), 500, 'CASH', undefined, context);
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, ?, 'patient-edge', 500, 500, 'PAID')`,
    ).run('debt-edge', context.clinicId, now, now, debtCharge.id);
    await service.refund(String(debtCharge.id), 50, 'debt refund', context);
  });

  it('covers null clinic context, missing charge context, member-card refund, and full debt refund', async () => {
    const now = new Date().toISOString();
    const service = new ChargeService(db);
    const appointments = new AppointmentService(db);
    const nullAppointment = await appointments.create({
      patientId: 'patient-edge',
      doctorId: 'user-admin-001',
      startTime: new Date(Date.now() + 3 * 86_400_000).toISOString(),
      endTime: new Date(Date.now() + 3 * 86_400_000 + 3_600_000).toISOString(),
      type: 'REGULAR',
    }, nullContext);
    expect(nullAppointment).toHaveProperty('id');

    const nullCharge = await service.create({
      patientId: 'patient-edge',
      items: [{ name: 'Null Clinic', category: 'EXAM', price: 100, quantity: 1 }],
    }, nullContext);
    await service.pay(String(nullCharge.id), 100, 'CASH', undefined, undefined);
    const nullIdemCharge = await service.create({
      patientId: 'patient-edge',
      items: [{ name: 'Null Idem', category: 'EXAM', price: 50, quantity: 1 }],
    }, nullContext);
    await service.pay(String(nullIdemCharge.id), 50, 'CASH', 'null-pay-request', undefined);
    await service.refund(String(nullCharge.id), 100, 'null refund', nullContext);

    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, NULL, ?, ?, NULL, 'NULL-CLINIC-P', 'Null Clinic Patient', 'UNKNOWN', '13600000008',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-null-clinic', now, now);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, NULL, ?, ?, NULL, ?, 'CARD-NULL-CLINIC', 500, 500, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-null-clinic', now, now, 'patient-null-clinic');
    const nullMemberCharge = await service.create({
      patientId: 'patient-null-clinic',
      items: [{ name: 'Null Member', category: 'IMPLANT', price: 100, quantity: 1 }],
    }, nullContext);
    await service.pay(String(nullMemberCharge.id), 100, 'MEMBER_CARD', undefined, nullContext);
    await service.refund(String(nullMemberCharge.id), 100, 'null member refund', nullContext);

    const inventory = new InventoryService(db);
    await inventory.createTransaction({ itemId: 'inventory-demo-001', type: 'OUT', quantity: 1 }, nullContext);

    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'MEMBER-REFUND', 'Member Refund', 'UNKNOWN', '13600000006',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-member-refund', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD-REFUND-MISSING', 500, 500, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-refund-missing', context.clinicId, now, now, 'patient-member-refund');
    const memberCharge = await service.create({
      patientId: 'patient-member-refund',
      items: [{ name: 'Member', category: 'IMPLANT', price: 200, quantity: 1 }],
    }, context);
    await service.pay(String(memberCharge.id), 200, 'MEMBER_CARD', undefined, context);
    db.prepare('UPDATE MemberCard SET status = ? WHERE id = ?').run('INACTIVE', 'card-refund-missing');
    await service.refund(String(memberCharge.id), 50, 'member missing', context);
    const cardAfterRefund = db.prepare('SELECT balance FROM MemberCard WHERE id = ?').get('card-refund-missing') as { balance: number };
    expect(Number(cardAfterRefund.balance)).toBe(350);

    const fullDebtCharge = await service.create({
      patientId: 'patient-edge',
      items: [{ name: 'Full Debt', category: 'EXAM', price: 300, quantity: 1 }],
    }, context);
    await service.pay(String(fullDebtCharge.id), 300, 'CASH', undefined, context);
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, ?, 'patient-edge', 300, 300, 'PAID')`,
    ).run('debt-edge-full', context.clinicId, now, now, fullDebtCharge.id);
    await service.refund(String(fullDebtCharge.id), 300, 'full debt refund', context);

    const paidOverCharge = await service.create({
      patientId: 'patient-edge',
      items: [{ name: 'Paid Over Debt', category: 'EXAM', price: 500, quantity: 1 }],
    }, context);
    await service.pay(String(paidOverCharge.id), 500, 'CASH', undefined, context);
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, ?, 'patient-edge', 100, 500, 'PAID')`,
    ).run('debt-edge-paid-over', context.clinicId, now, now, paidOverCharge.id);
    await service.refund(String(paidOverCharge.id), 50, 'paid over debt refund', context);
  });

  it('covers inventory transaction and stock branches', async () => {
    const service = new InventoryService(db);
    await expect(service.createTransaction({ itemId: 'x', type: 'BAD' as 'OUT', quantity: 1 }, context))
      .rejects.toThrow('IN, OUT, or ADJUST');
    await expect(service.createTransaction({ itemId: 'x', type: 'IN', quantity: 0 }, context))
      .rejects.toThrow('non-zero');
    await expect(service.createTransaction({ itemId: 'x', type: 'OUT', quantity: -1 }, context))
      .rejects.toThrow('must be positive');
    await expect(service.createTransaction({ itemId: 'missing-item', type: 'OUT', quantity: 1 }, context)).rejects.toThrow('Inventory item not found');
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'EDGE-ITEM', 'Edge Item', 'MAT', 'box', 10, 1, 100)`,
    ).run('inventory-edge', context.clinicId, now, now);
    await expect(service.createTransaction({ itemId: 'inventory-edge', type: 'OUT', quantity: 20 }, context)).rejects.toThrow('Insufficient stock');
    const input = await service.createTransaction({ itemId: 'inventory-edge', type: 'IN', quantity: 5 }, context);
    expect(input.afterStock).toBe(15);
    await service.createTransaction({ itemId: 'inventory-edge', type: 'ADJUST', quantity: -2 }, context);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'LOW-EDGE', 'Low Edge', 'MAT', 'box', 1, 5, 100)`,
    ).run('inventory-low-edge', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'SEARCHCAT', 'box', 1, 0, 100)`,
    ).run('inventory-null-label', context.clinicId, now, now);
    expect(service.lowStock(context)).toBeInstanceOf(Array);
  });

  it('covers follow-up generation with and without templates and adherence rate', async () => {
    const service = new FollowUpService(db);
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', ?, ?, 'COMPLETED')`,
    ).run('visit-edge-followup', context.clinicId, now, now, now, now);
    db.prepare(
      `INSERT INTO Treatment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, code, name, category,
         price, quantity, status, completedDate
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'visit-edge-followup', 'user-admin-001',
         'EDGE-T', 'T', 'GENERAL', 100, 1, 'COMPLETED', ?)`,
    ).run('treatment-edge-followup', context.clinicId, now, now, now.slice(0, 10));
    expect(service.adherence(context).rate).toBe(0);
    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status, completedAt
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', ?, 'x', 'COMPLETED', ?)`,
    ).run('followup-edge-completed', context.clinicId, now, now, now.slice(0, 10), now.slice(0, 10));
    expect(service.adherence(context).rate).toBeGreaterThanOrEqual(0);
    const noTemplateResult = await service.batchGenerate(1, nullContext);
    expect(noTemplateResult.generated).toBeGreaterThanOrEqual(1);

    db.prepare(
      `INSERT INTO FollowUpTemplate (
         id, clinicId, createdAt, updatedAt, deletedAt,
         name, daysAfter, content, assigneeId, isEnabled,
         minIntervalDays, recommendedIntervalDays, maxIntervalDays
       ) VALUES (?, ?, ?, ?, NULL, 'Null Template', NULL, NULL, NULL, 1, 1, 7, 14)`,
    ).run('template-edge-null', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', ?, ?, 'COMPLETED')`,
    ).run('visit-edge-null-template', context.clinicId, now, now, now, now);
    db.prepare(
      `INSERT INTO Treatment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, visitId, doctorId, code, name, category,
         price, quantity, status, completedDate
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'visit-edge-null-template', 'user-admin-001',
         'NULL-T', 'T', 'GENERAL', 100, 1, 'COMPLETED', NULL)`,
    ).run('treatment-edge-null-template', context.clinicId, now, now);
    const nullTemplateResult = await service.batchGenerate(1, nullContext);
    expect(nullTemplateResult.generated).toBeGreaterThanOrEqual(1);
  });

  it('covers backup missing, corrupt, encrypted, and restore branches', async () => {
    const backupDir = path.join(dataDir, 'edge-backups');
    fs.mkdirSync(backupDir, { recursive: true });
    const service = new BackupService(db, path.join(dataDir, 'v2.sqlite'), backupDir);
    await expect(service.verify('missing.sqlite')).rejects.toThrow('Backup file not found');

    process.env.V2_BACKUP_KEY = 'edge-backup-key-0123456789abcdef';
    const encrypted = await service.create({ type: 'AUTO', encrypted: true, operatorId: 'u1', operatorName: 'U1' });
    expect(String(encrypted.filename)).toMatch(/\.enc$/);
    await expect(service.stageRestore('missing.sqlite')).rejects.toThrow('Backup file not found');
    const shortPath = path.join(backupDir, 'short.enc');
    fs.writeFileSync(shortPath, 'too short');
    await expect(service.verify('short.enc')).rejects.toThrow('too short');
    const badMagicPath = path.join(backupDir, 'bad.enc');
    fs.writeFileSync(badMagicPath, Buffer.alloc(100));
    await expect(service.verify('bad.enc')).rejects.toThrow('header is invalid');

    const plain = await service.create({ type: 'MANUAL', encrypted: false });
    const corruptPlainPath = path.join(backupDir, 'corrupt.sqlite');
    const corruptPlainDb = new DatabaseClass(corruptPlainPath);
    corruptPlainDb.exec('CREATE TABLE BackupSample (id TEXT PRIMARY KEY)');
    corruptPlainDb.close();
    const corruptBuffer = fs.readFileSync(corruptPlainPath);
    corruptBuffer[20] ^= 0xff;
    fs.writeFileSync(corruptPlainPath, corruptBuffer);
    await expect(service.stageRestore('corrupt.sqlite')).rejects.toThrow('Backup integrity check failed before restore');

    const stagedResult = await service.stageRestore(String(plain.filename));
    expect(fs.existsSync(`${stagedResult.stagedPath}-wal`)).toBe(false);
    expect(fs.existsSync(`${stagedResult.stagedPath}-shm`)).toBe(false);
    expect(fs.existsSync(`${path.join(backupDir, String(plain.filename))}-wal`)).toBe(false);
    expect(fs.existsSync(`${path.join(backupDir, String(plain.filename))}-shm`)).toBe(false);
    const originalCopy = fs.copyFileSync.bind(fs);
    const copySpy = vi.spyOn(fs, 'copyFileSync').mockImplementation(((source: string, target: string) => {
      originalCopy(source, target);
      const stagedBuffer = fs.readFileSync(target);
      stagedBuffer[20] ^= 0xff;
      fs.writeFileSync(target, stagedBuffer);
    }) as unknown as typeof fs.copyFileSync);
    await expect(service.stageRestore(String(plain.filename))).rejects.toThrow('staged restore integrity check failed');
    copySpy.mockRestore();
    expect(service.cleanup(1).kept).toBe(1);
    delete process.env.V2_BACKUP_KEY;

    const noKeyService = new BackupService(db, path.join(dataDir, 'v2.sqlite'), path.join(dataDir, 'no-key-backups'));
    await expect(noKeyService.create({ encrypted: true })).rejects.toThrow('V2_BACKUP_KEY is required');
  });

  it('covers stats, print, and search label branches', () => {
    const nullContext = { ...context, clinicId: null };
    const stats = new StatsService(db);
    expect(stats.dashboard(nullContext)).toHaveProperty('patients');
    expect(stats.revenue('2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z', 'day', nullContext)).toBeInstanceOf(Array);
    expect(stats.revenue('2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z', 'month', nullContext)).toBeInstanceOf(Array);
    expect(stats.patientGrowth('2026-01-01T00:00:00.000Z', '2026-12-31T23:59:59.999Z', nullContext)).toBeInstanceOf(Array);
    expect(stats.inventoryStats(nullContext)).toBeInstanceOf(Array);
    expect(stats.memberStats(nullContext)).toHaveProperty('total');

    const print = new PrintService();
    expect(print.render('report', { title: 'Title', note: 'Note' })).toContain('Title');
    expect(print.render('report', { note: 'Note' })).toContain('report');

    const analytics = new AnalyticsService(db);
    expect(analytics.rfm(nullContext)).toBeInstanceOf(Array);
    expect(analytics.churn(nullContext)).toBeInstanceOf(Array);
    expect(analytics.doctorAnomalies(nullContext)).toBeInstanceOf(Array);
    const satisfaction = new SatisfactionService(db);
    expect(satisfaction.nps(nullContext).score).toBeGreaterThanOrEqual(0);
    expect(satisfaction.trend(nullContext)).toBeInstanceOf(Array);
    expect(satisfaction.doctorRankings(nullContext)).toBeInstanceOf(Array);
    const chargeAssistant = new ChargeAssistantService(db);
    expect(chargeAssistant.frequentItems(nullContext)).toBeInstanceOf(Array);
    const printTemplates = new PrintTemplateService(db);
    expect(printTemplates.list(nullContext)).toBeInstanceOf(Array);
    expect(() => printTemplates.render('missing-null-template', {}, nullContext)).toThrow('Print template not found');

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Supplier (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, phone
       ) VALUES (?, ?, ?, ?, NULL, 'S-EDGE', NULL, '1351234')`,
    ).run('supplier-edge', null, now, now);
    db.prepare(
      `INSERT INTO Supplier (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, phone
       ) VALUES (?, ?, ?, ?, NULL, NULL, 'Supplier Only', '13512345')`,
    ).run('supplier-edge-2', null, now, now);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'XNULL', NULL, 'UNKNOWN', 'PHONE123',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-null-name', null, now, now);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, 'UNKNOWN', 'SHORT',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-short-phone', null, now, now);
    const search = new SearchService(db);
    const results = search.search('Supplier', nullContext);
    expect(results.length).toBeGreaterThanOrEqual(1);
    db.prepare(
      `INSERT INTO SearchIndex(resource, recordId, clinicId, content)
       VALUES ('Unknown', 'search-unknown', 'clinic-v2-001', 'UNKNOWNTERM')`,
    ).run();
    search.search('UNKNOWNTERM', context);
    expect(search.search('XNULL', nullContext).some((row) => row.resource === 'patients' && row.label === 'XNULL')).toBe(true);
    expect(search.search('SHORT', nullContext).some((row) => (row.detail as Record<string, unknown>).phone === '****')).toBe(true);
    expect(search.search('SEARCHCAT', nullContext).some((row) => row.resource === 'inventoryItems' && row.label === '')).toBe(true);

    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-missing-label', 'user-admin-001', ?, ?, 'LABELSTATUS', 'REGULAR')`,
    ).run('appointment-label-null', now, now, now, now);
    db.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalAmount, status
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-missing-label', NULL, 100, 'LABELCHARGE')`,
    ).run('charge-label-null', now, now);
    db.prepare(
      `INSERT INTO Supplier (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, phone
       ) VALUES (?, NULL, ?, ?, NULL, NULL, NULL, 'LABELPHONE')`,
    ).run('supplier-label-null', now, now);
    db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status
       ) VALUES (?, NULL, ?, ?, NULL, 'patient-missing-label', ?, 'LABELCONTENT', 'PENDING')`,
    ).run('followup-label-null', now, now, now.slice(0, 10));
    expect(search.search('LABELSTATUS', nullContext).some((row) => row.resource === 'appointments' && row.label === '')).toBe(true);
    expect(search.search('LABELCHARGE', nullContext).some((row) => row.resource === 'charges' && row.label === '')).toBe(true);
    expect(search.search('LABELPHONE', nullContext).some((row) => row.resource === 'suppliers' && row.label === '')).toBe(true);
    expect(search.search('LABELCONTENT', nullContext).some((row) => row.resource === 'followUps' && row.label === '')).toBe(true);
  });

  it('covers sync push error branches', async () => {
    const service = new SyncService(db);
    expect(() => service.pull(now, '', 'bad-token', context)).toThrow('Device credentials');
    await expect(service.push({
      deviceId: 'device-1',
      deviceToken: 'bad-token',
      changes: [],
    }, context)).rejects.toThrow('not registered');
    expect(() => service.registerDevice('forbidden-device', 'x', { ...context, role: 'TECHNICIAN' }))
      .toThrow('Sync requires BOSS or ADMIN');
    expect(() => service.registerDevice('null-clinic-device', 'x', { ...context, clinicId: null }))
      .toThrow('Sync requires a clinic scope');
    const device = service.registerDevice('device-1', 'Edge Device', context);
    expect(() => service.pull(now, 'device-1', device.token, { ...context, clinicId: null }))
      .toThrow('Sync requires a clinic scope');
    await expect(service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [],
    }, { ...context, clinicId: null })).rejects.toThrow('Sync requires a clinic scope');
    expect(() => service.pull(now, 'device-1', device.token, { ...context, role: 'TECHNICIAN' }))
      .toThrow('Sync requires BOSS or ADMIN');
    await expect(service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [],
    }, { ...context, role: 'TECHNICIAN' })).rejects.toThrow('Sync requires BOSS or ADMIN');
    expect(service.pull(now, 'device-1', device.token, context)).toHaveProperty('changes');
    const notAllowed = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'NotAllowed', recordId: 'x', operation: 'INSERT', updatedAt: now, data: {} }],
    }, context);
    expect(notAllowed.failed).toBe(1);
    const missingData = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Patient', recordId: 'edge-sync-1', operation: 'INSERT', updatedAt: now, data: undefined }],
    }, context);
    expect(missingData.failed).toBe(1);
    const deleteResult = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Patient', recordId: 'edge-sync-2', operation: 'DELETE', updatedAt: now }],
    }, context);
    expect(deleteResult.failed).toBe(1);
    const updateResult = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'patient-sync-edge',
        operation: 'INSERT',
        updatedAt: now,
        data: { code: 'SYNC-EDGE', name: 'Sync Edge', gender: 'UNKNOWN', phone: '13600000002', source: 'OTHER', active: true },
      }],
    }, context);
    expect(updateResult.accepted).toBe(1);
    const updateAgain = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'patient-sync-edge',
        operation: 'INSERT',
        updatedAt: now,
        data: { name: 'Sync Edge Updated' },
      }],
    }, context);
    expect(updateAgain.accepted).toBe(1);
    const deleteTarget = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'patient-sync-delete',
        operation: 'INSERT',
        updatedAt: now,
        data: { code: 'SYNC-DELETE', name: 'Sync Delete', gender: 'UNKNOWN', phone: '13600000005', source: 'OTHER', active: true },
      }],
    }, context);
    expect(deleteTarget.accepted).toBe(1);
    const deleteExisting = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{ tableName: 'Patient', recordId: 'patient-sync-delete', operation: 'DELETE', updatedAt: now }],
    }, context);
    expect(deleteExisting.accepted).toBe(1);
    const deletedRow = db.prepare('SELECT deletedAt FROM Patient WHERE id = ?').get('patient-sync-delete') as { deletedAt: string | null } | undefined;
    expect(deletedRow?.deletedAt).not.toBeNull();
    const trickyData: Record<string, unknown> = {};
    Object.defineProperty(trickyData, 'code', {
      enumerable: true,
      get() {
        throw 'sync-string-error';
      },
    });
    const nonError = await service.push({
      deviceId: 'device-1',
      deviceToken: device.token,
      changes: [{
        tableName: 'Patient',
        recordId: 'patient-sync-non-error',
        operation: 'INSERT',
        updatedAt: now,
        data: trickyData,
      }],
    }, context);
    expect(nonError.failed).toBe(1);
    expect(() => service.cleanup(now, { ...context, clinicId: null })).toThrow('Sync requires a clinic scope');
    expect(service.cleanup(now, context).deleted).toBeGreaterThanOrEqual(0);
  });

  it('enforces tenant scope in core workflows', async () => {
    const now = new Date().toISOString();
    const otherClinic = 'other-clinic';

    db.prepare(
      `INSERT INTO Appointment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, endTime, status, type
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', ?, ?, 'BOOKED', 'REGULAR')`,
    ).run('appointment-other', otherClinic, now, now, now, new Date(Date.now() + 3_600_000).toISOString());
    const appointments = new AppointmentService(db);
    await expect(appointments.transition('appointment-other', 'CANCELLED', context)).rejects.toThrow('Appointment not found');

    db.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalAmount, paidAmount, refundedAmount, discount, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'OTHER-CHARGE', 100, 0, 0, 0, 'UNPAID')`,
    ).run('charge-other', otherClinic, now, now);
    const charges = new ChargeService(db);
    await expect(charges.pay('charge-other', 10, 'CASH', undefined, context)).rejects.toThrow('Charge not found');
    await expect(charges.refund('charge-other', 10, 'other', context)).rejects.toThrow('Charge not found');

    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'charge-other', 'patient-demo-001', 100, 0, 'UNPAID')`,
    ).run('debt-other', otherClinic, now, now);
    const debts = new DebtService(db);
    await expect(debts.pay('debt-other', 10, context)).rejects.toThrow('Debt record not found');

    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'OTHER-CARD', 100, 100, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-other', otherClinic, now, now);
    const cards = new MemberCardService(db);
    await expect(cards.recharge('card-other', 10, context)).rejects.toThrow('Member card not found');
    await expect(cards.consume('card-other', 10, context)).rejects.toThrow('Member card not found');
    await expect(cards.addPoints('card-other', 10, context)).rejects.toThrow('Member card not found');
    await expect(cards.recharge('missing-card', 10, context)).rejects.toThrow('Member card not found');
    expect(() => cards.create({ patientId: 'patient-demo-001', cardNo: 'BAD-STATUS', status: 'BAD', level: 'NORMAL' }, context))
      .toThrow('Invalid member card status');
    expect(() => cards.create({ patientId: 'patient-demo-001', cardNo: 'BAD-LEVEL', status: 'ACTIVE', level: 'BAD' }, context))
      .toThrow('Invalid member card level');
    expect(() => cards.create({ patientId: '', cardNo: '', status: 'ACTIVE', level: 'NORMAL' }, context))
      .toThrow('patientId and cardNo are required');
    expect(() => cards.create({} as never, context)).toThrow('patientId and cardNo are required');
    const createdCard = cards.create({ patientId: 'patient-demo-001', cardNo: 'CREATED-CARD', status: 'ACTIVE', level: 'NORMAL' }, context);
    expect(createdCard.id).toBeDefined();
    expect(() => cards.create({ patientId: 'patient-demo-001', cardNo: 'CREATED-CARD', status: 'ACTIVE', level: 'NORMAL' }, context))
      .toThrow('Member card number already exists');

    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'OTHER-ITEM', 'Other Item', 'MAT', 'box', 10, 1, 100)`,
    ).run('inventory-other', otherClinic, now, now);
    const inventory = new InventoryService(db);
    await expect(inventory.createTransaction({ itemId: 'inventory-other', type: 'IN', quantity: 1 }, context))
      .rejects.toThrow('Inventory item not found');
    expect(inventory.expiringSoon(30, { ...context, clinicId: null })).toBeInstanceOf(Array);
  });

  it('manages users through the admin service', async () => {
    const auth = new AuthService(db);
    const created = await auth.createUser({
      username: 'admin-created',
      password: 'password123',
      name: 'Created',
      role: 'DOCTOR',
    }, context);
    expect(created.id).toBeDefined();
    await expect(auth.createUser({
      username: 'admin-created',
      password: 'password123',
      name: 'Duplicate',
      role: 'DOCTOR',
    }, context)).rejects.toThrow('Username already exists');
    await expect(auth.createUser({
      username: 'bad-role',
      password: 'password123',
      name: 'Bad Role',
      role: 'SUPER',
    }, context)).rejects.toThrow('Invalid user role');
    await expect(auth.createUser({
      username: 'short',
      password: 'short',
      name: 'Short',
      role: 'DOCTOR',
    }, context)).rejects.toThrow('at least 8 characters');
    await expect(auth.createUser({
      username: '',
      password: 'password123',
      name: 'No Username',
      role: 'DOCTOR',
    }, context)).rejects.toThrow('Username and name are required');
    await expect(auth.createUser({} as never, context)).rejects.toThrow('Username and name are required');

    const updated = await auth.updateUser(created.id, { name: 'Updated', phone: '13800000000', role: 'NURSE', active: false }, context);
    expect(updated.name).toBe('Updated');
    await expect(auth.updateUser(created.id, { role: 'BAD' }, context)).rejects.toThrow('Invalid user role');
    await expect(auth.updateUser('missing-user', {}, context)).rejects.toThrow('User not found');
    await expect(auth.resetPassword('missing-user', 'password123', context)).rejects.toThrow('User not found');
    await expect(auth.resetPassword(created.id, 'short', context)).rejects.toThrow('at least 8 characters');
    await expect(auth.resetPassword(created.id, 'newpassword123', context)).resolves.toEqual({ id: created.id });

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES (?, ?, ?, ?, NULL, 'other-user', 'hash', 'Other', 'BOSS', 1, 0, 0)`,
    ).run('user-other', 'other-clinic', now, now);
    await expect(auth.updateUser('user-other', {}, context)).rejects.toThrow('User not found');
    await expect(auth.resetPassword('user-other', 'password123', context)).rejects.toThrow('User not found');

    const replayHash = createHash('sha256').update('replay-token').digest('hex');
    db.prepare(
      'UPDATE User SET refreshToken = ?, refreshTokenExpiresAt = ? WHERE id = ?',
    ).run(replayHash, new Date(Date.now() + 86_400_000).toISOString(), 'user-admin-001');
    db.prepare('INSERT INTO UsedRefreshToken (tokenHash, userId, usedAt) VALUES (?, ?, ?)')
      .run(replayHash, 'user-admin-001', now);
    await expect(auth.refresh('replay-token')).rejects.toThrow('Invalid refresh token');
  });

  it('covers HR, alerts, member cards, purchase, processing, risk, prescription, ceph, progress, import, debt, notifications, satisfaction branches', async () => {
    const hr = new HrService(db);
    expect(hr.attendance(now.slice(0, 10), context)).toBeInstanceOf(Array);
    expect(hr.attendance()).toBeInstanceOf(Array);
    db.prepare(
      `INSERT INTO LeaveRequest (
         id, clinicId, createdAt, updatedAt, deletedAt,
         userId, startDate, endDate, type, reason, status
       ) VALUES (?, ?, ?, ?, NULL, 'user-admin-001', '2026-08-01', '2026-08-02', 'ANNUAL', 'r', 'PENDING')`,
    ).run('leave-edge-reject', context.clinicId, now, now);
    expect(hr.approveLeave('leave-edge-reject', 'user-admin-001', false, context).status).toBe('REJECTED');
    expect(() => hr.approveLeave('missing-leave', 'user-admin-001', true, context)).toThrow('Leave request not found');

    const alerts = new AlertService(db);
    expect(alerts.open()).toBeInstanceOf(Array);
    expect(() => alerts.setStatus('missing-alert', 'RESOLVED', 'user-admin-001')).toThrow('Business alert not found');
    expect(() => alerts.setStatus('missing-alert', 'RESOLVED')).toThrow('Business alert not found');
    alerts.create({
      alertType: 'TEST',
      level: 'INFO',
      severity: 'INFO',
      title: 'T',
      message: 'M',
      source: 'edge',
    });
    expect(() => alerts.setStatus('missing-alert', 'RESOLVED', 'user-admin-001', context)).toThrow('Business alert not found');

    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'CARD-EDGE-2', 100, 100, 0, 'ACTIVE', 10, 10, 'NORMAL')`,
    ).run('card-edge-2', context.clinicId, now, now);
    const cards = new MemberCardService(db);
    await expect(cards.recharge('card-edge-2', 0, context)).rejects.toThrow('Recharge');
    await expect(cards.consume('card-edge-2', 0, context)).rejects.toThrow('Consume');
    await expect(cards.consume('card-edge-2', 101, context)).rejects.toThrow('Insufficient member card');
    await expect(cards.addPoints('card-edge-2', -11, context)).rejects.toThrow('Insufficient points');
    await expect(cards.addPoints('card-edge-2', 0, context)).rejects.toThrow('non-zero integer');
    await expect(cards.addPoints('card-edge-2', 1.5, context)).rejects.toThrow('non-zero integer');
    await cards.addPoints('card-edge-2', -5, context);
    await expect(cards.recharge('missing-card', 1, context)).rejects.toThrow('Member card not found');
    await cards.recharge('card-edge-2', 10, nullContext);
    await cards.consume('card-edge-2', 10, nullContext);
    await cards.addPoints('card-edge-2', 5, nullContext);

    const purchase = new PurchaseOrderService(db);
    await expect(purchase.receive('missing-po', context)).rejects.toThrow('Purchase order not found');
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'PO-EDGE', NULL, 0, 'RECEIVED')`,
    ).run('po-edge', context.clinicId, now, now);
    await expect(purchase.receive('po-edge', context)).rejects.toThrow('not pending');
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'PO-EDGE-2', NULL, 0, 'PENDING')`,
    ).run('po-edge-2', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'po-edge-2', NULL, 'No item', 1, 100, 100)`,
    ).run('poi-edge-null', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'PO-OTHER', 'Other Clinic Item', 'MAT', 'box', 1, 0, 100)`,
    ).run('inventory-po-other', 'clinic-v2-other', now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'po-edge-2', 'inventory-po-other', 'Other Clinic Item', 1, 100, 100)`,
    ).run('poi-edge-missing', context.clinicId, now, now);
    await expect(purchase.receive('po-edge-2', context)).rejects.toThrow('missing inventory items');
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'PO-ITEM', 'PO Item', 'MAT', 'box', 1, 0, 100)`,
    ).run('inventory-po-valid', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'PO-EDGE-3', NULL, 0, 'PENDING')`,
    ).run('po-edge-3', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, ?, ?, ?, NULL, 'po-edge-3', 'inventory-po-valid', 'Valid', 2, 100, 200)`,
    ).run('poi-edge-valid', context.clinicId, now, now);
    await purchase.receive('po-edge-3', context);
    db.prepare(
      `INSERT INTO PurchaseOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, supplierId, totalAmount, status
       ) VALUES (?, NULL, ?, ?, NULL, 'PO-EDGE-NULL', NULL, 0, 'PENDING')`,
    ).run('po-edge-null', now, now);
    db.prepare(
      `INSERT INTO PurchaseOrderItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         orderId, itemId, name, quantity, unitPrice, subtotal
       ) VALUES (?, NULL, ?, ?, NULL, 'po-edge-null', 'inventory-po-valid', 'Null Clinic', 1, 100, 100)`,
    ).run('poi-edge-null-clinic', now, now);
    await purchase.receive('po-edge-null', nullContext);
    const stock = db.prepare('SELECT stock FROM InventoryItem WHERE id = ?').get('inventory-po-valid') as { stock: number };
    expect(Number(stock.stock)).toBe(4);

    const processing = new ProcessingOrderService(db);
    expect(() => processing.transition('missing-processing', 'SENT', context)).toThrow('Processing order not found');
    db.prepare(
      `INSERT INTO ProcessingOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, patientId, status
       ) VALUES (?, ?, ?, ?, NULL, 'PO-EDGE-PROC', 'patient-demo-001', 'DRAFT')`,
    ).run('proc-edge', context.clinicId, now, now);
    expect(processing.transition('proc-edge', 'CANCELLED', context).status).toBe('CANCELLED');
    expect(() => processing.transition('proc-edge', 'SENT', context)).toThrow('Cannot transition');
    db.prepare(
      `INSERT INTO ProcessingOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, patientId, status
       ) VALUES (?, NULL, ?, ?, NULL, 'PROC-NULL', 'patient-demo-001', 'DRAFT')`,
    ).run('proc-edge-null', now, now);
    expect(processing.transition('proc-edge-null', 'SENT', nullContext).status).toBe('SENT');

    const risk = new PatientRiskService(db);
    const riskResult = risk.calculate('patient-demo-001', context);
    expect(riskResult).toHaveProperty('cariesScore');
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'RISK', 'Risk Patient', 'UNKNOWN', '13600000004',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-risk-high', context.clinicId, now, now);
    for (let i = 0; i < 16; i += 1) {
      db.prepare(
        `INSERT INTO Treatment (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, doctorId, code, name, category, price, quantity, status
         ) VALUES (?, ?, ?, ?, NULL, 'patient-risk-high', 'user-admin-001', ?, 'T', 'GENERAL', 100, 1, 'COMPLETED')`,
      ).run(`risk-treatment-${i}`, context.clinicId, now, now, `R-${i}`);
    }
    const riskHigh = new PatientRiskService(db).calculate('patient-risk-high', context);
    expect(riskHigh).toHaveProperty('cariesScore');
    expect(() => risk.calculate('missing-risk-patient', context)).toThrow('Patient not found');
    for (const [patientId, codePrefix, count] of [
      ['patient-risk-medium', 'RM', 6],
      ['patient-risk-high-level', 'RH', 12],
    ] as Array<[string, string, number]>) {
      db.prepare(
        `INSERT INTO Patient (
           id, clinicId, createdAt, updatedAt, deletedAt,
           code, name, gender, phone, tags, allergies, medicalHistory,
           medicationHistory, systemicDiseases, source, active
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, 'UNKNOWN', '13600000005',
           '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
      ).run(patientId, context.clinicId, now, now, codePrefix, patientId);
      for (let i = 0; i < count; i += 1) {
        db.prepare(
          `INSERT INTO Treatment (
             id, clinicId, createdAt, updatedAt, deletedAt,
             patientId, doctorId, code, name, category, price, quantity, status
           ) VALUES (?, ?, ?, ?, NULL, ?, 'user-admin-001', ?, 'T', 'GENERAL', 100, 1, 'COMPLETED')`,
        ).run(`${patientId}-${i}`, context.clinicId, now, now, patientId, `${codePrefix}-${i}`);
      }
      new PatientRiskService(db).calculate(patientId, context);
    }
    new PatientRiskService(db).calculate('patient-risk-medium', nullContext);

    const prescription = new PrescriptionSafetyService(db);
    await expect(() => prescription.check('missing-rx', context)).toThrow('Prescription not found');
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId
       ) VALUES (?, ?, ?, ?, NULL, 'missing-patient', 'user-admin-001')`,
    ).run('rx-edge-missing-patient', context.clinicId, now, now);
    expect(prescription.check('rx-edge-missing-patient', context).safe).toBe(true);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'ALLERGY-EMPTY', 'Empty Allergy', 'UNKNOWN', '13600000007',
         '[]', '', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-allergy-empty', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId
       ) VALUES (?, ?, ?, ?, NULL, 'patient-allergy-empty', 'user-admin-001')`,
    ).run('rx-edge-empty-allergy', context.clinicId, now, now);
    expect(prescription.check('rx-edge-empty-allergy', context).safe).toBe(true);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'ALLERGY-OBJECT', 'Object Allergy', 'UNKNOWN', '13600000010',
         '[]', '{}', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-allergy-object', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId
       ) VALUES (?, ?, ?, ?, NULL, 'patient-allergy-object', 'user-admin-001')`,
    ).run('rx-edge-object-allergy', context.clinicId, now, now);
    expect(prescription.check('rx-edge-object-allergy', context).safe).toBe(true);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'ALLERGY-NULL', 'Null Allergy', 'UNKNOWN', '13600000011',
         '[]', NULL, '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('patient-allergy-null', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Prescription (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId
       ) VALUES (?, ?, ?, ?, NULL, 'patient-allergy-null', 'user-admin-001')`,
    ).run('rx-edge-null-allergy', context.clinicId, now, now);
    expect(prescription.check('rx-edge-null-allergy', context).safe).toBe(true);

    const ceph = new CephalometricService(db);
    await expect(() => ceph.compute('missing-ceph', context)).toThrow('Cephalometric case not found');
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', '{}', 'DRAFT')`,
    ).run('ceph-edge-empty', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-empty', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', NULL, 'DRAFT')`,
    ).run('ceph-edge-null-landmarks', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-null-landmarks', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', 'not-json', 'DRAFT')`,
    ).run('ceph-edge-malformed-landmarks', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-malformed-landmarks', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', '[]', 'DRAFT')`,
    ).run('ceph-edge-array-landmarks', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-array-landmarks', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png', '123', 'DRAFT')`,
    ).run('ceph-edge-number-landmarks', context.clinicId, now, now);
    expect(ceph.compute('ceph-edge-number-landmarks', context).metrics).toEqual({});
    db.prepare(
      `INSERT INTO CephalometricCase (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, imageUrl, landmarksJson, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'x.png',
         '{"sella":{"x":0,"y":0},"nasion":{"x":10,"y":0},"upperIncisor":{"x":0,"y":10},"lowerIncisor":{"x":10,"y":10}}', 'DRAFT')`,
    ).run('ceph-edge-full', context.clinicId, now, now);
    const cephMetrics = ceph.compute('ceph-edge-full', context).metrics as Record<string, number>;
    expect(cephMetrics.snLength).toBeGreaterThan(0);
    expect(cephMetrics.interincisalAngle).toBeGreaterThanOrEqual(0);

    const progress = new TreatmentProgressService(db);
    await expect(() => progress.summary('missing-plan', context)).toThrow('Treatment plan not found');
    db.prepare(
      `INSERT INTO TreatmentPlan (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, name, status, totalFee
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', 'Plan', 'APPROVED', 0)`,
    ).run('plan-edge-empty', context.clinicId, now, now);
    expect(progress.summary('plan-edge-empty', context).progress).toBe(0);

    const bulk = new BulkImportService(db);
    await expect(bulk.importRows('not-a-resource', [], context)).rejects.toThrow('cannot import');
    const bulkResult = await bulk.importRows('patients', [
      { code: 'BULK-EDGE', name: 'Invalid Gender', gender: 'INVALID', phone: '13600000003', source: 'OTHER' },
    ], context);
    expect(bulkResult.failed).toBe(1);
    const missingRequired = await bulk.importRows('patients', [{ name: 'Missing Code' }], context);
    expect(missingRequired.failed).toBe(1);
    await expect(bulk.importRows('users', [], context)).rejects.toThrow('disabled');
    await expect(bulk.importRows('operationLogs', [], context)).rejects.toThrow('Resource cannot import: operationLogs');
    await expect(bulk.importRows('patients', [], { ...context, role: 'TECHNICIAN' })).rejects.toThrow('Forbidden resource');
    await expect(bulk.importRows('patients', null as unknown as Array<Record<string, unknown>>, context)).rejects.toThrow('array');
    const tooManyRows = Array.from({ length: 1001 }, (_, index) => ({
      code: `BULK-${index}`,
      name: 'Bulk',
      gender: 'UNKNOWN',
      phone: '13600000000',
      source: 'OTHER',
    }));
    await expect(bulk.importRows('patients', tooManyRows, context)).rejects.toThrow('at most');
    const nonErrorRow: Record<string, unknown> = {};
    Object.defineProperty(nonErrorRow, 'code', {
      enumerable: true,
      get() {
        throw 'bulk-string-error';
      },
    });
    const nonErrorImport = await bulk.importRows('patients', [nonErrorRow], context);
    expect(nonErrorImport.failed).toBe(1);

    const debt = new DebtService(db);
    await expect(debt.pay('missing-debt', 1, context)).rejects.toThrow('Debt record not found');
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'charge-edge-debt', 'patient-demo-001', 500, 0, 'UNPAID')`,
    ).run('debt-edge-pay', context.clinicId, now, now);
    await expect(debt.pay('debt-edge-pay', 0, context)).rejects.toThrow('Invalid debt payment');
    expect((await debt.pay('debt-edge-pay', 500, context)).status).toBe('PAID');

    const notifications = new NotificationService(db);
    expect(notifications.list('user-admin-001')).toBeInstanceOf(Array);
    expect(() => notifications.markRead('missing-notification', context.userId)).toThrow('Notification not found');

    const satisfaction = new SatisfactionService(db);
    const npsBefore = satisfaction.nps(context);
    db.prepare(
      `INSERT INTO SatisfactionSurvey (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, score, channel, comment, surveyDate
       ) VALUES (?, ?, ?, ?, ?, 'patient-demo-001', 'user-admin-001', 10, 'CLINIC', 'deleted', '2026-08-04')`,
    ).run('satisfaction-deleted', context.clinicId, now, now, now);
    expect(satisfaction.nps(context)).toEqual(npsBefore);
    expect(satisfaction.trend(context)).toBeInstanceOf(Array);
    expect(satisfaction.doctorRankings(context)).toBeInstanceOf(Array);

    const workflow = new ClinicalWorkflowService(db);
    expect(() => workflow.registrationStatus('missing-registration', 'IN_PROGRESS', context)).toThrow('Registration not found');
    db.prepare(
      `INSERT INTO Registration (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, type, status, registeredAt
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'user-admin-001', 'REGULAR', 'REGISTERED', ?)`,
    ).run('registration-edge-invalid', context.clinicId, now, now, now);
    expect(() => workflow.registrationStatus('registration-edge-invalid', 'COMPLETED', context)).toThrow('Cannot transition');

    const replenishment = new ReplenishmentService(db);
    expect(() => replenishment.applyToPurchaseOrder(['missing-suggestion'], context)).toThrow('No applicable suggestions');

    db.prepare(
      `INSERT INTO WechatMessage (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, type, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'TEXT', 'batch', 'PENDING')`,
    ).run('wechat-edge-batch', context.clinicId, now, now);
    expect(new WechatService(db).sendBatch(['wechat-edge-batch'], context).sent).toBe(1);

    expect(() => new PrintTemplateService(db).render('missing-template', {}, context)).toThrow('Print template not found');
  });
});
