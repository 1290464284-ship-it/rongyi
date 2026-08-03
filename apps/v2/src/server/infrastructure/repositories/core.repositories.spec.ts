import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase } from '../database';
import {
  SqliteDebtRepository,
  SqliteFollowUpRepository,
  SqliteInventoryRepository,
  SqliteMemberCardRepository,
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
      status: 'UNPAID',
      createdAt: now,
      updatedAt: now,
    });
    repo.updatePayment('charge-repo', 400, 'PARTIAL', now, 'CASH');
    repo.updateRefund('charge-repo', 100, 'PARTIAL', now);
    const charge = repo.findById('charge-repo');
    expect(charge?.paidAmount).toBe(400);
    expect(charge?.refundedAmount).toBe(100);
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
  });
});
