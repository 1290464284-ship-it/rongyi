import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from '../database';
import { runMigrations } from '../migrations';
import {
  SqliteAlertRepository,
  SqliteAuthRepository,
  SqliteClinicalWorkflowRepository,
  SqliteDebtRepository,
  SqliteFollowUpRepository,
  SqliteHrRepository,
  SqliteInventoryRepository,
  SqliteMemberCardRepository,
  SqlitePatientRiskRepository,
  SqliteProcessingOrderRepository,
  SqlitePurchaseOrderRepository,
  SqliteWechatMessageRepository,
} from './core.repositories';
import { SqliteChargeRepository } from './charge.repository';

describe('core repositories', () => {
  let db: Database.Database;
  let dataDir: string;
  const now = '2026-08-03T00:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-core-repo-'));
    db = createDatabase(dataDir);
    runMigrations(db);
    for (const [id, code, name] of [
      ['clinic-v2-001', 'V2-1', 'Clinic 1'],
      ['clinic-v2-other', 'V2-2', 'Clinic 2'],
    ] as Array<[string, string, string]>) {
      db.prepare(
        `INSERT INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
         VALUES (?, NULL, ?, ?, NULL, ?, ?, 1)`,
      ).run(id, now, now, code, name);
    }
    for (const id of ['patient-repo', 'patient-deleted', 'patient-inactive', 'patient']) {
      db.prepare(
        `INSERT INTO Patient (
           id, clinicId, createdAt, updatedAt, deletedAt,
           code, name, gender, phone, tags, allergies, medicalHistory,
           medicationHistory, systemicDiseases, source, active
         ) VALUES (?, NULL, ?, ?, NULL, ?, 'Core Patient', 'UNKNOWN', '13000000000',
           '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
      ).run(id, now, now, `CORE-${id}`);
    }
    db.prepare(
      `INSERT INTO Treatment (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, code, name, category, price, quantity, status
       ) VALUES (?, NULL, ?, ?, NULL, 'patient', NULL, 'T-1', 'Treatment', 'GENERAL', 100, 1, 'COMPLETED')`,
    ).run('treatment-1', now, now);
    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES (?, NULL, ?, ?, NULL, 'core-operator', 'hash', 'Core Operator', 'BOSS', 1, 0, 0)`,
    ).run('user-1', now, now);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('persists member card balance and logs', () => {
    const repo = new SqliteMemberCardRepository(db);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, NULL, ?, 'CARD', 0, 0, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-repo', null, now, now, 'patient-repo');
    repo.updateRecharge('card-repo', 500, 500, now);
    repo.updateConsume('card-repo', 300, 200, now);
    const card = repo.findById('card-repo');
    expect(card?.balance).toBe(300);
    expect(card?.totalConsume).toBe(200);
  });

  it('filters soft-deleted rows and supports member-card refund lookups', () => {
    const member = new SqliteMemberCardRepository(db);
    db.prepare(
      `INSERT INTO MemberCard (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, cardNo, balance, totalRecharge, totalConsume,
         status, points, totalPoints, level
       ) VALUES (?, ?, ?, ?, ?, ?, 'CARD-DELETED', 0, 0, 0, 'ACTIVE', 0, 0, 'NORMAL')`,
    ).run('card-deleted', null, now, now, now, 'patient-deleted');
    expect(member.findById('card-deleted')).toBeNull();

    member.create({
      id: 'card-inactive-refund',
      clinicId: null,
      patientId: 'patient-inactive',
      cardNo: 'CARD-INACTIVE',
      balance: 100,
      totalRecharge: 100,
      totalConsume: 0,
      status: 'INACTIVE',
      points: 0,
      totalPoints: 0,
      level: 'NORMAL',
      createdAt: now,
      updatedAt: now,
    });
    expect(member.findByPatient('patient-inactive')).toBeNull();
    expect(member.findByPatientForRefund('patient-inactive')).not.toBeNull();
    expect(member.findByPatientForRefund('patient-inactive', 'clinic-v2-001')).not.toBeNull();
    expect(member.findByPatientForRefund('patient-no-card')).toBeNull();

    const hr = new SqliteHrRepository(db);
    db.prepare(
      `INSERT INTO Attendance (
         id, clinicId, createdAt, updatedAt, deletedAt,
         userId, workDate, status
       ) VALUES (?, NULL, ?, ?, ?, 'user-deleted', '2026-08-03', 'PRESENT')`,
    ).run('attendance-deleted', now, now, now);
    expect(hr.attendance('2026-08-03').some((row) => row.id === 'attendance-deleted')).toBe(false);

    db.prepare(
      `INSERT INTO LeaveRequest (
         id, clinicId, createdAt, updatedAt, deletedAt,
         userId, startDate, endDate, type, reason, status
       ) VALUES (?, NULL, ?, ?, ?, 'user-deleted', '2026-08-01', '2026-08-02', 'ANNUAL', 'r', 'PENDING')`,
    ).run('leave-deleted', now, now, now);
    expect(hr.approveLeave('leave-deleted', 'APPROVED', 'reviewer', now)).toBe(0);
  });

  it('creates inventory transactions and returns low stock', () => {
    const repo = new SqliteInventoryRepository(db);
    db.prepare(
      `INSERT INTO InventoryItem (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, unit, stock, minStock, price
       ) VALUES (?, ?, ?, ?, NULL, 'LOW', 'Low Item', 'MAT', 'box', 1, 5, 100)`,
    ).run('inventory-repo', null, now, now);
    repo.updateStock('inventory-repo', 10, now);
    repo.createTransaction({
      id: 'tx-repo',
      clinicId: null,
      itemId: 'inventory-repo',
      type: 'IN',
      quantity: 9,
      beforeStock: 1,
      afterStock: 10,
      createdAt: now,
      updatedAt: now,
    });
    const item = repo.findItem('inventory-repo');
    expect(item?.stock).toBe(10);
    expect(repo.lowStock().length).toBe(0);
  });

  it('updates debt payment', () => {
    const repo = new SqliteDebtRepository(db);
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'charge', 'patient', 1000, 0, 'UNPAID')`,
    ).run('debt-repo', null, now, now);
    repo.updatePaid('debt-repo', 400, 'PARTIAL', now);
    expect(repo.findById('debt-repo')?.paidAmount).toBe(400);
  });

  it('creates and updates charge records', () => {
    const repo = new SqliteChargeRepository(db);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'CH', 'Charge Patient', 'UNKNOWN', '13300000000',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('charge-patient', null, now, now);
    repo.create({
      id: 'charge-repo',
      clinicId: null,
      patientId: 'charge-patient',
      number: 'CHG-1',
      totalAmount: 1000,
      discount: 0,
      status: 'UNPAID',
      createdAt: now,
      updatedAt: now,
    });
    repo.updatePayment('charge-repo', 400, 'PARTIAL', now, 'CASH', undefined, null);
    repo.updateRefund('charge-repo', 100, 'PARTIAL', now, null);
    const charge = repo.findById('charge-repo');
    expect(charge?.paidAmount).toBe(400);
    expect(charge?.refundedAmount).toBe(100);
    repo.createItem({
      id: 'charge-item-2',
      clinicId: 'clinic-v2-001',
      chargeId: 'charge-repo',
      treatmentId: 'treatment-1',
      name: 'Exam 2',
      category: 'EXAM',
      price: 200,
      quantity: 1,
      teethNumbers: ['1'],
      subtotal: 200,
      createdAt: now,
      updatedAt: now,
    });
    repo.createItem({
      id: 'charge-item-3',
      clinicId: null,
      chargeId: 'charge-repo',
      treatmentId: null,
      name: 'Exam 3',
      category: 'EXAM',
      price: 300,
      quantity: 1,
      teethNumbers: [],
      subtotal: 300,
      createdAt: now,
      updatedAt: now,
    });
    repo.updatePayment('charge-repo', 500, 'PAID', now, 'MEMBER_CARD', 'card-repo', null);
    const paidCharge = repo.findById('charge-repo');
    expect(paidCharge?.payMethod).toBe('MEMBER_CARD');
    expect(paidCharge?.memberCardId).toBe('card-repo');
    repo.updatePayment('charge-repo', 600, 'PAID', now, undefined, null, null);
    const cashCharge = repo.findById('charge-repo');
    expect(cashCharge?.payMethod).toBe('MEMBER_CARD');
    expect(cashCharge?.memberCardId).toBe('card-repo');
  });

  it('does not update charges from another clinic through direct repository writes', () => {
    const repo = new SqliteChargeRepository(db);
    db.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalAmount, discount, status
       ) VALUES (?, ?, ?, ?, NULL, 'charge-patient', 'CHG-OTHER-CLINIC', 1000, 0, 'UNPAID')`,
    ).run('charge-other-clinic', 'clinic-v2-other', now, now);
    repo.updatePayment('charge-other-clinic', 100, 'PARTIAL', now, 'CASH', undefined, 'clinic-v2-001');
    repo.updatePayment('charge-other-clinic', 0, 'UNPAID', now, undefined, 'card-other', 'clinic-v2-001');
    repo.updateRefund('charge-other-clinic', 50, 'PARTIAL', now, 'clinic-v2-001');
    const row = db.prepare('SELECT paidAmount, refundedAmount, status FROM Charge WHERE id = ?').get('charge-other-clinic') as {
      paidAmount: number;
      refundedAmount: number;
      status: string;
    };
    expect(Number(row.paidAmount)).toBe(0);
    expect(Number(row.refundedAmount)).toBe(0);
    expect(row.status).toBe('UNPAID');
  });

  it('creates purchase orders and marks them received', () => {
    const repo = new SqlitePurchaseOrderRepository(db);
    repo.createOrder({
      id: 'po-repo',
      clinicId: null,
      number: 'PO-1',
      supplierId: null,
      totalAmount: 100,
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    });
    repo.createItem({
      id: 'poi-repo',
      clinicId: null,
      orderId: 'po-repo',
      itemId: null,
      name: 'Item',
      quantity: 1,
      unitPrice: 100,
      subtotal: 100,
      createdAt: now,
      updatedAt: now,
    });
    repo.markReceived('po-repo', now, now);
    expect(repo.findById('po-repo')?.status).toBe('RECEIVED');
    expect(repo.itemsByOrder('po-repo').length).toBe(1);
  });

  it('transitions processing orders and sends wechat messages', () => {
    const processing = new SqliteProcessingOrderRepository(db);
    db.prepare(
      `INSERT INTO ProcessingOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         number, patientId, status
       ) VALUES (?, ?, ?, ?, NULL, 'PO-PROC', 'patient', 'DRAFT')`,
    ).run('proc-repo', null, now, now);
    processing.updateStatus('proc-repo', 'SENT', now);
    expect(processing.findById('proc-repo')?.status).toBe('SENT');

    const wechat = new SqliteWechatMessageRepository(db);
    db.prepare(
      `INSERT INTO WechatMessage (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, type, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient', 'TEXT', 'hello', 'PENDING')`,
    ).run('wechat-repo', null, now, now);
    wechat.markSent('wechat-repo', now, now);
    const message = db.prepare('SELECT * FROM WechatMessage WHERE id = ?').get('wechat-repo') as Record<string, unknown>;
    expect(message.status).toBe('SENT');
  });

  it('inserts follow-up records and lists reminders', () => {
    const repo = new SqliteFollowUpRepository(db);
    db.prepare(
      `INSERT INTO Patient (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, gender, phone, tags, allergies, medicalHistory,
         medicationHistory, systemicDiseases, source, active
       ) VALUES (?, ?, ?, ?, NULL, 'FU', 'Follow Up Patient', 'UNKNOWN', '13400000000',
         '[]', '[]', '[]', '[]', '[]', 'WALK_IN', 1)`,
    ).run('followup-patient', null, now, now);
    repo.insert({
      id: 'followup-repo',
      clinicId: null,
      patientId: 'followup-patient',
      planDate: now.slice(0, 10),
      content: 'Reminder',
      status: 'PENDING',
      createdAt: now,
      updatedAt: now,
    });
    expect(repo.reminders().length).toBeGreaterThanOrEqual(1);
    expect(repo.complete('followup-repo', now, now)).toBe(1);
    expect(repo.complete('followup-repo', now, now)).toBe(0);
    expect(repo.complete('followup-repo', now, now, 'clinic-v2-001')).toBe(0);
    const completed = db.prepare('SELECT status, completedAt FROM FollowUp WHERE id = ?').get('followup-repo') as {
      status: string;
      completedAt: string;
    };
    expect(completed.status).toBe('COMPLETED');
    expect(completed.completedAt).toBe(now);
  });

  it('covers repository nullish, boolean, and auth mapping branches', () => {
    const member = new SqliteMemberCardRepository(db);
    member.insertLog({
      id: 'member-log-clinic',
      clinicId: 'clinic-v2-001',
      createdAt: now,
      updatedAt: now,
      cardId: 'card-repo',
      type: 'RECHARGE',
      amount: 100,
      balanceAfter: 100,
      remark: 'r',
    });
    member.insertLog({
      id: 'member-log-null',
      clinicId: null,
      createdAt: now,
      updatedAt: now,
      cardId: 'card-repo',
      type: 'CONSUME',
      amount: -10,
      balanceAfter: 90,
      remark: null,
    });
    member.insertPointLog({
      id: 'member-point-clinic',
      clinicId: 'clinic-v2-001',
      createdAt: now,
      updatedAt: now,
      cardId: 'card-repo',
      type: 'ADD',
      points: 10,
      pointsAfter: 10,
    });
    member.insertPointLog({
      id: 'member-point-null',
      clinicId: null,
      createdAt: now,
      updatedAt: now,
      cardId: 'card-repo',
      type: 'DEDUCT',
      points: -1,
      pointsAfter: 9,
    });

    const inventory = new SqliteInventoryRepository(db);
    inventory.createTransaction({
      id: 'inventory-tx-clinic',
      clinicId: 'clinic-v2-001',
      createdAt: now,
      updatedAt: now,
      itemId: 'inventory-repo',
      type: 'IN',
      quantity: 1,
      beforeStock: 10,
      afterStock: 11,
      operatorId: 'user-1',
      remark: 'r',
    });
    inventory.createTransaction({
      id: 'inventory-tx-null',
      clinicId: null,
      createdAt: now,
      updatedAt: now,
      itemId: 'inventory-repo',
      type: 'OUT',
      quantity: 1,
      beforeStock: 11,
      afterStock: 10,
      operatorId: null,
      remark: null,
    });

    const auth = new SqliteAuthRepository(db);
    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, active, loginAttempts, tokenVersion
       ) VALUES (?, NULL, ?, ?, NULL, 'core-auth', 'hash', 'Core Auth', 'BOSS', 1, NULL, NULL)`,
    ).run('core-auth-user', now, now);
    const authUser = auth.findById('core-auth-user');
    expect(authUser?.clinicId).toBeNull();
    expect(authUser?.loginAttempts).toBe(0);
    expect(authUser?.tokenVersion).toBe(0);
    const authMap = (auth as unknown as {
      map(row: Record<string, unknown>): { deletedAt: string | null };
    }).map;
    expect(authMap({
      id: 'map-deleted',
      username: 'u',
      passwordHash: 'h',
      name: 'n',
      role: 'BOSS',
      active: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: '2026-08-04T00:00:00.000Z',
    }).deletedAt).toBe('2026-08-04T00:00:00.000Z');
    expect(authMap({
      id: 'map-not-deleted',
      username: 'u',
      passwordHash: 'h',
      name: 'n',
      role: 'BOSS',
      active: 1,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }).deletedAt).toBeNull();
    auth.insertUser({
      id: 'admin-created',
      clinicId: 'clinic-v2-001',
      username: 'created',
      passwordHash: 'hash',
      name: 'Created',
      role: 'DOCTOR',
      phone: '13800000000',
      active: true,
      loginAttempts: 0,
      lockedUntil: null,
      tokenVersion: 0,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    expect(auth.findById('admin-created')).not.toBeNull();
    expect(auth.updateUser('admin-created', { name: 'Updated', phone: null, role: 'NURSE', active: false }, now, 'clinic-v2-001')).toBe(1);
    expect(auth.findById('admin-created')?.name).toBe('Updated');
    expect(auth.resetPassword('admin-created', 'new-hash', now, 'clinic-v2-001')).toBe(1);
    expect(auth.findById('admin-created')?.tokenVersion).toBe(1);
    auth.addClinicMembership('admin-created', 'clinic-v2-001', 'BOSS', now, now);
    expect(auth.clinicMemberships('admin-created')).toContainEqual(
      expect.objectContaining({ clinicId: 'clinic-v2-001' }),
    );
    auth.addClinicMembership('admin-created', 'clinic-v2-other', 'BOSS', now, now);
    expect(auth.clinicMemberships('admin-created').length).toBeGreaterThanOrEqual(2);
    auth.setCurrentClinic('admin-created', 'clinic-v2-other', now);
    expect(auth.findById('admin-created')?.currentClinicId).toBe('clinic-v2-other');
    auth.markRefreshTokenUsed('used-hash', 'admin-created', now);
    expect(auth.isRefreshTokenUsed('used-hash')).toBe(true);
    expect(auth.cleanupUsedRefreshTokens(now)).toBeGreaterThanOrEqual(0);

    const risk = new SqlitePatientRiskRepository(db);
    risk.insert({
      id: 'risk-core-clinic',
      clinicId: 'clinic-v2-001',
      createdAt: now,
      updatedAt: now,
      patientId: 'patient',
      cariesScore: 10,
      periodontalScore: 10,
      implantScore: 10,
      cariesLevel: 'LOW',
      periodontalLevel: 'LOW',
      implantLevel: 'LOW',
      factorSnapshotJson: '{}',
      assessedById: 'user-1',
    });
    risk.insert({
      id: 'risk-core-null',
      clinicId: null,
      createdAt: now,
      updatedAt: now,
      patientId: 'patient',
      cariesScore: 0,
      periodontalScore: 0,
      implantScore: 0,
      cariesLevel: 'LOW',
      periodontalLevel: 'LOW',
      implantLevel: 'LOW',
      factorSnapshotJson: '{}',
      assessedById: null,
    });

    const clinical = new SqliteClinicalWorkflowRepository(db);
    clinical.createVisit({
      id: 'visit-core-clinic',
      clinicId: 'clinic-v2-001',
      createdAt: now,
      updatedAt: now,
      patientId: 'patient',
      doctorId: 'doctor-1',
      userId: 'user-1',
    });
    clinical.createVisit({
      id: 'visit-core-null',
      clinicId: null,
      createdAt: now,
      updatedAt: now,
      patientId: 'patient',
      doctorId: null,
      userId: 'user-1',
    });
    clinical.lockMedicalRecord('visit-core-clinic', true, 'user-1', now);
    clinical.lockMedicalRecord('visit-core-clinic', false, null as unknown as string, now);
    clinical.updateStatus('Visit', 'visit-core-clinic', 'COMPLETED', now, { endTime: null });

    const followUp = new SqliteFollowUpRepository(db);
    followUp.insert({
      id: 'followup-core-null',
      clinicId: 'clinic-v2-001',
      createdAt: now,
      updatedAt: now,
      patientId: 'followup-patient',
      planDate: now.slice(0, 10),
      content: null,
      status: 'PENDING',
      assigneeId: null,
      templateId: null,
    });
  });

  it('covers scoped repository branches', () => {
    const member = new SqliteMemberCardRepository(db);
    member.create({
      id: 'card-scope',
      clinicId: 'clinic-v2-001',
      patientId: 'patient',
      cardNo: 'CARD-SCOPE',
      balance: 0,
      totalRecharge: 0,
      totalConsume: 0,
      status: 'ACTIVE',
      points: 0,
      totalPoints: 0,
      level: 'NORMAL',
      createdAt: now,
      updatedAt: now,
    });
    member.create({
      id: 'card-scope-null',
      clinicId: null,
      patientId: 'patient',
      cardNo: 'CARD-SCOPE-NULL',
      balance: 0,
      totalRecharge: 0,
      totalConsume: 0,
      status: 'INACTIVE',
      points: 0,
      totalPoints: 0,
      level: 'NORMAL',
      createdAt: now,
      updatedAt: now,
    });
    expect(member.findById('card-scope', 'clinic-v2-001')).not.toBeNull();

    const auth = new SqliteAuthRepository(db);
    auth.insertUser({
      id: 'auth-scope',
      clinicId: null,
      username: 'scope-user',
      passwordHash: 'hash',
      name: 'Scope',
      role: 'NURSE',
      active: false,
      loginAttempts: 0,
      lockedUntil: null,
      tokenVersion: 0,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    expect(auth.findById('auth-scope')?.active).toBe(false);
    expect(auth.updateUser('auth-scope', {}, now, null)).toBe(1);
    expect(auth.updateUser('auth-scope', { active: true }, now, null)).toBe(1);
    expect(auth.resetPassword('auth-scope', 'scope-hash', now, null)).toBe(1);

    auth.insertUser({
      id: 'user-other-clinic',
      clinicId: 'clinic-v2-other',
      username: 'other-clinic-user',
      passwordHash: 'hash',
      name: 'Other Clinic',
      role: 'NURSE',
      active: true,
      loginAttempts: 0,
      lockedUntil: null,
      tokenVersion: 0,
      refreshToken: null,
      refreshTokenExpiresAt: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
    expect(auth.updateUser('user-other-clinic', { name: 'Ignored' }, now, 'clinic-v2-001')).toBe(0);
    expect(auth.resetPassword('user-other-clinic', 'new-hash', now, 'clinic-v2-001')).toBe(0);
    expect(auth.findById('user-other-clinic')?.name).toBe('Other Clinic');

    db.prepare(
      `INSERT INTO WechatMessage (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, type, content, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient', 'TEXT', 'x', 'PENDING')`,
    ).run('wechat-scope', 'clinic-v2-001', now, now);
    const wechat = new SqliteWechatMessageRepository(db);
    expect(wechat.findById('wechat-scope', 'clinic-v2-001')).not.toBeNull();
    expect(wechat.findById('wechat-scope')).not.toBeNull();
    expect(wechat.markSent('wechat-scope', now, now, 'clinic-v2-001')).toBe(1);

    db.prepare(
      `INSERT INTO BusinessAlert (
         id, clinicId, createdAt, updatedAt, deletedAt,
         level, title, message, source, status
       ) VALUES (?, ?, ?, ?, NULL, 'WARNING', 'T', 'M', 'scope', 'OPEN')`,
    ).run('alert-scope', 'clinic-v2-001', now, now);
    const alert = new SqliteAlertRepository(db);
    expect(alert.open('clinic-v2-001').length).toBeGreaterThanOrEqual(1);
    expect(alert.setStatus('alert-scope', 'RESOLVED', 'user', now, 'clinic-v2-001')).toBe(1);
    expect(alert.open()).toBeInstanceOf(Array);
    expect(alert.setStatus('missing-alert', 'RESOLVED', 'user', now)).toBe(0);

    db.prepare(
      `INSERT INTO Attendance (
         id, clinicId, createdAt, updatedAt, deletedAt,
         userId, workDate, status
       ) VALUES (?, ?, ?, ?, NULL, 'user', ?, 'PRESENT')`,
    ).run('attendance-scope', 'clinic-v2-001', now, now, now.slice(0, 10));
    const hr = new SqliteHrRepository(db);
    expect(hr.attendance(now.slice(0, 10), 'clinic-v2-001')).toBeInstanceOf(Array);
    expect(hr.attendance(undefined, 'clinic-v2-001')).toBeInstanceOf(Array);
    expect(hr.attendance(now.slice(0, 10))).toBeInstanceOf(Array);
    expect(hr.attendance()).toBeInstanceOf(Array);
    db.prepare(
      `INSERT INTO LeaveRequest (
         id, clinicId, createdAt, updatedAt, deletedAt,
         userId, startDate, endDate, type, reason, status
       ) VALUES (?, ?, ?, ?, NULL, 'user', ?, ?, 'ANNUAL', 'r', 'PENDING')`,
    ).run('leave-scope', 'clinic-v2-001', now, now, now.slice(0, 10), now.slice(0, 10));
    expect(hr.approveLeave('leave-scope', 'APPROVED', 'reviewer', now, 'clinic-v2-001')).toBe(1);
    expect(hr.approveLeave('leave-scope', 'REJECTED', 'reviewer', now)).toBe(1);

    const clinical = new SqliteClinicalWorkflowRepository(db);
    db.prepare(
      `INSERT INTO Visit (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, startTime, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient', 'doctor', ?, 'IN_PROGRESS')`,
    ).run('visit-scope', 'clinic-v2-001', now, now, now);
    db.prepare(
      `INSERT INTO MedicalRecord (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, doctorId, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient', 'doctor', 'DRAFT')`,
    ).run('record-scope', 'clinic-v2-001', now, now);
    expect(clinical.getRow('Visit', 'visit-scope', 'clinic-v2-001')).not.toBeNull();
    clinical.updateStatus('Visit', 'visit-scope', 'COMPLETED', now, { endTime: now }, 'clinic-v2-001');
    clinical.lockMedicalRecord('record-scope', true, 'user', now, 'clinic-v2-001');
    clinical.lockMedicalRecord('record-scope', false, null as unknown as string, now);
  });
});
