import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../../infrastructure/database';
import { runMigrations } from '../../../infrastructure/migrations';
import { ConflictError, ValidationError } from '../../../infrastructure/errors';
import type { AppContext } from '../../../../domain/contracts';
import { ChargeService } from './charge.service';

describe('ChargeService coverage', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-06T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-charge-service-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date(now),
    };
    db.prepare(
      `INSERT INTO TreatmentCatalog (
         id, clinicId, createdAt, updatedAt, deletedAt,
         code, name, category, price, remark, costType, anesthesia, parentId, businessCategory
       ) VALUES (?, ?, ?, ?, NULL, 'CAT-1', 'Catalog One', 'GENERAL', 100, NULL, NULL, 0, NULL, NULL)`,
    ).run('cat-1', context.clinicId, now, now);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function validItems(overrides: Array<{
    name: string;
    category: string;
    price: number;
    quantity: number;
    teethNumbers?: string[];
    costType?: 'SERVICE' | 'MATERIAL';
    catalogId?: string;
  }> = []): Array<{
    name: string;
    category: string;
    price: number;
    quantity: number;
    teethNumbers?: string[];
    costType?: 'SERVICE' | 'MATERIAL';
    catalogId?: string;
  }> {
    return overrides.length > 0 ? overrides : [{ name: 'Exam', category: 'GENERAL', price: 100, quantity: 1 }];
  }

  it('rejects missing and mismatched catalog prices', async () => {
    const service = new ChargeService(db);
    await expect(service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'Missing', category: 'GENERAL', price: 100, quantity: 1, catalogId: 'cat-missing' }]),
    }, context)).rejects.toThrow(ValidationError);
    await expect(service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'Mismatch', category: 'GENERAL', price: 200, quantity: 1, catalogId: 'cat-1' }]),
    }, context)).rejects.toThrow(ValidationError);
  });

  it('cancels unpaid charges and rejects paid charges', async () => {
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'Cancel Me', category: 'GENERAL', price: 100, quantity: 1, catalogId: 'cat-1' }]),
    }, context);
    await service.cancel(String(created.id), context);
    const charge = db.prepare('SELECT deletedAt FROM Charge WHERE id = ?').get(String(created.id)) as { deletedAt: string | null };
    expect(charge.deletedAt).not.toBeNull();

    const paid = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'Paid', category: 'GENERAL', price: 400, quantity: 1 }]),
    }, context);
    db.prepare("UPDATE Charge SET status = 'PAID', paidAmount = 400 WHERE id = ?").run(String(paid.id));
    await expect(service.cancel(String(paid.id), context)).rejects.toThrow(ConflictError);
  });

  it('updates an existing debt when the charge is paid partially and fully', async () => {
    const service = new ChargeService(db);
    const created = await service.create({
      patientId: 'patient-demo-001',
      items: validItems([{ name: 'Debt Item', category: 'GENERAL', price: 500, quantity: 1 }]),
    }, context);
    const chargeId = String(created.id);
    db.prepare(
      `INSERT INTO Debt (
         id, clinicId, createdAt, updatedAt, deletedAt,
         chargeId, patientId, totalAmount, paidAmount, status
       ) VALUES (?, ?, ?, ?, NULL, ?, 'patient-demo-001', 500, 0, 'UNPAID')`,
    ).run('debt-charge-coverage', context.clinicId, now, now, chargeId);

    await service.pay(chargeId, 200, 'CASH', undefined, context);
    let debt = db.prepare('SELECT paidAmount, status FROM Debt WHERE id = ?').get('debt-charge-coverage') as { paidAmount: number; status: string };
    expect(Number(debt.paidAmount)).toBe(200);
    expect(debt.status).toBe('PARTIAL');

    await service.pay(chargeId, 300, 'CASH', undefined, context);
    debt = db.prepare('SELECT paidAmount, status FROM Debt WHERE id = ?').get('debt-charge-coverage') as { paidAmount: number; status: string };
    expect(Number(debt.paidAmount)).toBe(500);
    expect(debt.status).toBe('PAID');
  });
});
