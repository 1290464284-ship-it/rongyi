// DebtService 模块化 spec：自 services.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
// 注：欠款测试与 ChargeService 联动（收费 → DEBT 部分支付 → 生成欠款），
// 共享库内相对顺序与聚合文件一致。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../../infrastructure/database';
import { runMigrations } from '../../../infrastructure/migrations';
import { ChargeService } from './charge.service';
import { DebtService } from './debt.service';
import type { AppContext } from '../../../../domain/contracts';

describe('DebtService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-debt-'));
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

  it('creates and updates debt records for partial DEBT payments', async () => {
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: [{ name: 'Debt Exam', category: 'EXAM', price: 200, quantity: 1 }],
    }, context);
    const partial = await service.pay(String(created.id), 80, 'DEBT', undefined, context);
    expect(partial.status).toBe('PARTIAL');
    const debt = db.prepare('SELECT id, totalAmount, paidAmount, status FROM Debt WHERE chargeId = ?').get(String(created.id)) as {
      id: string;
      totalAmount: number;
      paidAmount: number;
      status: string;
    };
    expect(debt.totalAmount).toBe(200);
    expect(debt.paidAmount).toBe(80);
    expect(debt.status).toBe('PARTIAL');

    await new DebtService(db).pay(String(debt.id), 120, context);
    const updated = db.prepare('SELECT paidAmount, status FROM Debt WHERE chargeId = ?').get(String(created.id)) as {
      paidAmount: number;
      status: string;
    };
    expect(updated.paidAmount).toBe(200);
    expect(updated.status).toBe('PAID');
    const charge = db.prepare('SELECT paidAmount, status FROM Charge WHERE id = ?').get(String(created.id)) as {
      paidAmount: number;
      status: string;
    };
    expect(charge.paidAmount).toBe(200);
    expect(charge.status).toBe('PAID');
  });

  it('debt payments fall back patient ids and write ledgers with null clinics', async () => {
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: [{ name: 'Fallback Debt', category: 'EXAM', price: 100, quantity: 1 }],
    }, context);
    await service.pay(String(created.id), 30, 'DEBT', undefined, context);
    const debt = db.prepare('SELECT id FROM Debt WHERE chargeId = ?').get(String(created.id)) as { id: string };
    // 债务患者缺失 → 回退收费单患者
    db.prepare('UPDATE Debt SET patientId = NULL WHERE id = ?').run(debt.id);
    await new DebtService(db).pay(debt.id, 40, context);
    const ledger1 = db.prepare(
      `SELECT patientId FROM PaymentLedger WHERE chargeId = ? AND method = 'DEBT' ORDER BY createdAt DESC LIMIT 1`,
    ).get(String(created.id)) as { patientId: string };
    expect(ledger1.patientId).toBe('patient-demo-001');

    // 收费单患者也缺失 + 空诊所 → 患者空串、clinicId 落 NULL
    db.prepare('UPDATE Charge SET patientId = NULL WHERE id = ?').run(String(created.id));
    await new DebtService(db).pay(debt.id, 20, { ...context, clinicId: null });
    const ledger2 = db.prepare(
      `SELECT patientId, clinicId FROM PaymentLedger WHERE chargeId = ? AND method = 'DEBT' ORDER BY createdAt DESC LIMIT 1`,
    ).get(String(created.id)) as { patientId: string; clinicId: string | null };
    expect(ledger2.patientId).toBe('');
    expect(ledger2.clinicId).toBeNull();
  });

  it('rolls back debt payment when the charge update fails', async () => {
    // Dedicated temp database so DROP TABLE Charge cannot affect the shared
    // db used by the other tests in this file (or trip FK constraints from
    // existing ChargeItem rows).
    const localDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-debt-rollback-'));
    const localDb = createDatabase(localDir);
    seedDatabase(localDb);
    runMigrations(localDb);
    try {
      const now = new Date().toISOString();
      localDb.prepare(
        `INSERT INTO Charge (
           id, clinicId, createdAt, updatedAt, deletedAt, patientId, number,
           totalAmount, paidAmount, refundedAmount, discount, status
         ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'CHG-ROLLBACK-DEBT', 500, 0, 0, 0, 'UNPAID')`,
      ).run('charge-rollback-debt', context.clinicId, now, now);
      localDb.prepare(
        `INSERT INTO Debt (
           id, clinicId, createdAt, updatedAt, deletedAt, chargeId, patientId,
           totalAmount, paidAmount, status
         ) VALUES (?, ?, ?, ?, NULL, 'charge-rollback-debt', 'patient-demo-001', 500, 0, 'UNPAID')`,
      ).run('debt-rollback-pay', context.clinicId, now, now);

      // Make the second write (Charge UPDATE) fail after the Debt update runs.
      localDb.prepare('DROP TABLE Charge').run();
      await expect(new DebtService(localDb).pay('debt-rollback-pay', 100, context)).rejects.toThrow();
      const debt = localDb.prepare('SELECT paidAmount FROM Debt WHERE id = ?').get('debt-rollback-pay') as {
        paidAmount: number;
      };
      expect(Number(debt.paidAmount)).toBe(0);
    } finally {
      localDb.close();
      fs.rmSync(localDir, { recursive: true, force: true });
    }
  });

  it('keeps a charge UNPAID when its paid balance is still non-positive', async () => {
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt, patientId, number,
         totalAmount, paidAmount, refundedAmount, discount, status
       ) VALUES (?, ?, ?, ?, NULL, 'patient-demo-001', 'CHG-UNPAID-DEBT', 200, -100, 0, 0, 'UNPAID')`,
    ).run('charge-unpaid-debt', context.clinicId, now, now);
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt, chargeId, patientId,
         totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, 'charge-unpaid-debt', 'patient-demo-001', 200, 0, 'UNPAID')`,
    ).run('debt-unpaid-pay', context.clinicId, now, now);

    const result = await new DebtService(db).pay('debt-unpaid-pay', 50, context);

    expect(result.status).toBe('PARTIAL');
    const debt = db.prepare('SELECT paidAmount, status FROM Debt WHERE id = ?').get('debt-unpaid-pay') as {
      paidAmount: number;
      status: string;
    };
    expect(Number(debt.paidAmount)).toBe(50);
    expect(debt.status).toBe('PARTIAL');
    const charge = db.prepare('SELECT paidAmount, status FROM Charge WHERE id = ?').get('charge-unpaid-debt') as {
      paidAmount: number;
      status: string;
    };
    // 负数 paidAmount 是损坏/历史脏数据场景：chargePaid = min(200, -100 + 50) = -50 → UNPAID。
    expect(Number(charge.paidAmount)).toBe(-50);
    expect(charge.status).toBe('UNPAID');
  });
});
