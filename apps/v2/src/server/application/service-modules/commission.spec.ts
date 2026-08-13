import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { CommissionService } from './commission';

describe('CommissionService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-commission-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'trace',
      now: () => new Date('2026-08-05T10:00:00.000Z'),
    };
    db.prepare(
      `INSERT INTO User (id, clinicId, createdAt, updatedAt, deletedAt, username, passwordHash, name, role, active, loginAttempts, tokenVersion)
       VALUES ('user-doctor-commission', ?, ?, ?, NULL, 'commission-doctor', 'x', '提成医生', 'DOCTOR', 1, 0, 0)`,
    ).run(context.clinicId, now, now);
    db.prepare(
      `INSERT INTO User (id, clinicId, createdAt, updatedAt, deletedAt, username, passwordHash, name, role, active, loginAttempts, tokenVersion)
       VALUES ('user-doctor-commission-2', ?, ?, ?, NULL, 'commission-doctor-2', 'x', '提成医生二', 'DOCTOR', 1, 0, 0)`,
    ).run(context.clinicId, now, now);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  afterEach(() => {
    db.prepare('DELETE FROM CommissionStatement').run();
    db.prepare('DELETE FROM CommissionRule').run();
    db.prepare("DELETE FROM ChargeItem WHERE id LIKE 'item-comm-%'").run();
    db.prepare("DELETE FROM Charge WHERE id LIKE 'charge-comm-%'").run();
  });

  function insertCharge(
    id: string,
    doctorId: string | null,
    paidAt: string,
    options: {
      totalAmount?: number;
      paidAmount?: number;
      refundedAmount?: number;
      status?: string;
    } = {},
  ): void {
    const totalAmount = options.totalAmount ?? 100_000;
    db.prepare(
      `INSERT INTO Charge (
         id, patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount,
         discount, status, payMethod, paidAt, remark, clinicId, createdAt, updatedAt, deletedAt
       ) VALUES (?, 'patient-demo-001', NULL, ?, ?, ?, ?, ?, 0, ?, 'CASH', ?, NULL, ?, ?, ?, NULL)`,
    ).run(
      id, doctorId, `CHG-COMMISSION-${id}`, totalAmount,
      options.paidAmount ?? totalAmount, options.refundedAmount ?? 0,
      options.status ?? 'PAID', paidAt, context.clinicId, now, now,
    );
  }

  function insertItem(chargeId: string, id: string, category: string, costType: string, subtotal: number): void {
    db.prepare(
      `INSERT INTO ChargeItem (
         id, chargeId, treatmentId, inventoryItemId, consumedQuantity, name, category, price,
         quantity, teethNumbers, subtotal, clinicId, createdAt, updatedAt, deletedAt, costType
       ) VALUES (?, ?, NULL, NULL, 0, ?, ?, ?, 1, '[]', ?, ?, ?, ?, NULL, ?)`,
    ).run(id, chargeId, `项目-${id}`, category, subtotal, subtotal, context.clinicId, now, now, costType);
  }

  it('validates rule input and manages the rule lifecycle', () => {
    const service = new CommissionService(db);
    expect(() => service.createRule({ name: '', rateType: 'PERCENT', rate: 10 }, context)).toThrow(ValidationError);
    expect(() => service.createRule({ name: 'x', rateType: 'PERCENT', rate: -1 }, context)).toThrow(ValidationError);
    expect(() => service.createRule({ name: 'x', rateType: 'PERCENT', rate: 10_001 }, context)).toThrow(ValidationError);
    expect(() => service.createRule({ name: 'x', rateType: 'BONUS' as never, rate: 1 }, context)).toThrow(ValidationError);
    expect(() => service.createRule({ name: 'x', rateType: 'PERCENT', rate: 10, costType: 'DRUG' as never }, context))
      .toThrow(ValidationError);

    const created = service.createRule({ name: '默认服务提成', rateType: 'PERCENT', rate: 1000 }, context);
    expect(created).toMatchObject({ name: '默认服务提成', rateType: 'PERCENT', rate: 1000, enabled: 1, category: null });
    const updated = service.updateRule(created.id, { rate: 1200, enabled: false }, context);
    expect(updated).toMatchObject({ rate: 1200, enabled: 0 });
    expect(() => service.updateRule('missing', { rate: 1 }, context)).toThrow(NotFoundError);
    expect(() => service.deleteRule('missing', context)).toThrow(NotFoundError);
    service.deleteRule(created.id, context);
    expect(() => service.updateRule(created.id, { rate: 1 }, context)).toThrow(NotFoundError);
    expect(() => service.deleteRule(created.id, context)).toThrow(NotFoundError);
    expect(service.listRules(context).some((rule) => rule.id === created.id)).toBe(false);
  });

  it('calculates percent commission per paid charge and writes a statement', () => {
    const service = new CommissionService(db);
    service.createRule({ name: '服务 10%', category: 'TREATMENT', costType: 'SERVICE', rateType: 'PERCENT', rate: 1000 }, context);
    insertCharge('charge-comm-1', 'user-doctor-commission', '2026-08-01T09:00:00.000Z');
    insertItem('charge-comm-1', 'item-comm-1', 'TREATMENT', 'SERVICE', 60_000);
    insertItem('charge-comm-1', 'item-comm-2', 'MATERIAL', 'MATERIAL', 40_000);

    const statements = service.calculate('2026-08', context);
    const statement = statements.find((row) => row.doctorId === 'user-doctor-commission');
    expect(statement).toBeDefined();
    expect(statement?.totalCharged).toBe(100_000);
    expect(statement?.totalCommission).toBe(6000);
    expect(statement?.breakdown).toEqual([
      expect.objectContaining({ category: 'TREATMENT', costType: 'SERVICE', charged: 60_000, commission: 6000 }),
    ]);
  });

  it('prefers doctor-specific rules and applies fixed rates once per charge', () => {
    const service = new CommissionService(db);
    service.createRule({ name: '默认 5%', rateType: 'PERCENT', rate: 500 }, context);
    service.createRule({
      name: '指定医生固定 200',
      doctorId: 'user-doctor-commission',
      rateType: 'FIXED',
      rate: 20_000,
    }, context);
    insertCharge('charge-comm-2', 'user-doctor-commission', '2026-08-02T09:00:00.000Z', { totalAmount: 50_000 });
    insertItem('charge-comm-2', 'item-comm-3', 'EXAM', 'SERVICE', 20_000);
    insertItem('charge-comm-2', 'item-comm-4', 'EXAM', 'SERVICE', 30_000);

    const statements = service.calculate('2026-08', context);
    const statement = statements.find((row) => row.doctorId === 'user-doctor-commission');
    expect(statement?.totalCommission).toBe(20_000);
  });

  it('ignores refunded amounts and charges outside the period', () => {
    const service = new CommissionService(db);
    service.createRule({ name: '服务 5%', rateType: 'PERCENT', rate: 500 }, context);
    insertCharge('charge-comm-3', 'user-doctor-commission', '2026-08-03T09:00:00.000Z', {
      totalAmount: 40_000,
      paidAmount: 40_000,
      refundedAmount: 40_000,
      status: 'REFUNDED',
    });
    insertItem('charge-comm-3', 'item-comm-5', 'TREATMENT', 'SERVICE', 40_000);
    insertCharge('charge-comm-4', 'user-doctor-commission', '2026-07-31T09:00:00.000Z', { totalAmount: 30_000 });
    insertItem('charge-comm-4', 'item-comm-6', 'TREATMENT', 'SERVICE', 30_000);
    insertCharge('charge-comm-5', 'user-doctor-commission-2', '2026-08-03T09:00:00.000Z', { totalAmount: 20_000 });
    insertItem('charge-comm-5', 'item-comm-7', 'TREATMENT', 'SERVICE', 20_000);

    const statements = service.calculate('2026-08', context);
    expect(statements.find((row) => row.doctorId === 'user-doctor-commission')).toBeUndefined();
    expect(statements.find((row) => row.doctorId === 'user-doctor-commission-2')?.totalCommission).toBe(1000);
  });

  it('filters statements by period and enforces doctor self-scope', () => {
    const service = new CommissionService(db);
    expect(() => service.statements('2026-13', context)).toThrow(ValidationError);
    expect(() => service.statements('bad', context)).toThrow(ValidationError);
    service.calculate('2026-08', context);
    const doctorContext = { ...context, userId: 'user-doctor-commission-2', role: 'DOCTOR' as const };
    const doctorStatements = service.statements('2026-08', doctorContext, { doctorId: 'user-doctor-commission' });
    expect(doctorStatements.every((row) => row.doctorId === 'user-doctor-commission-2')).toBe(true);
  });

  it('returns an empty result when there are no paid charges in the period', () => {
    const service = new CommissionService(db);
    expect(service.calculate('2026-01', context)).toEqual([]);
  });

  it('recalculating after a full refund removes stale commission statements', () => {
    const service = new CommissionService(db);
    service.createRule({ name: '服务 5%', rateType: 'PERCENT', rate: 500 }, context);
    insertCharge('charge-comm-stale', 'user-doctor-commission', '2026-08-04T09:00:00.000Z');
    insertItem('charge-comm-stale', 'item-comm-stale', 'TREATMENT', 'SERVICE', 40_000);
    expect(service.calculate('2026-08', context).some((row) => row.doctorId === 'user-doctor-commission')).toBe(true);

    db.prepare(
      `UPDATE Charge SET paidAmount = 0, refundedAmount = ?, status = 'REFUNDED' WHERE id = ?`,
    ).run(40_000, 'charge-comm-stale');
    expect(service.calculate('2026-08', context)).toEqual([]);
  });

  it('recalculating after a doctor loses all eligible charges removes their statement', () => {
    const service = new CommissionService(db);
    service.createRule({ name: '服务 5%', rateType: 'PERCENT', rate: 500 }, context);
    insertCharge('charge-comm-d1', 'user-doctor-commission', '2026-08-04T09:00:00.000Z', { totalAmount: 10_000 });
    insertItem('charge-comm-d1', 'item-comm-d1', 'TREATMENT', 'SERVICE', 10_000);
    insertCharge('charge-comm-d2', 'user-doctor-commission-2', '2026-08-04T09:00:00.000Z', { totalAmount: 20_000 });
    insertItem('charge-comm-d2', 'item-comm-d2', 'TREATMENT', 'SERVICE', 20_000);
    service.calculate('2026-08', context);
    expect(service.statements('2026-08', context)).toHaveLength(2);

    db.prepare('DELETE FROM Charge WHERE id = ?').run('charge-comm-d1');
    const statements = service.calculate('2026-08', context);
    expect(statements).toHaveLength(1);
    expect(statements[0].doctorId).toBe('user-doctor-commission-2');
  });

  it('rounds per-item shares without exceeding the paid base', () => {
    const service = new CommissionService(db);
    service.createRule({ name: '服务 100%', rateType: 'PERCENT', rate: 10_000 }, context);
    insertCharge('charge-comm-round', 'user-doctor-commission', '2026-08-04T09:00:00.000Z', {
      totalAmount: 101,
      paidAmount: 101,
    });
    insertItem('charge-comm-round', 'item-comm-round-1', 'TREATMENT', 'SERVICE', 50);
    insertItem('charge-comm-round', 'item-comm-round-2', 'TREATMENT', 'SERVICE', 50);

    const statement = service.calculate('2026-08', context)
      .find((row) => row.doctorId === 'user-doctor-commission');
    expect(statement?.totalCharged).toBe(101);
    expect(statement?.breakdown?.reduce((sum, line) => sum + line.charged, 0)).toBe(101);
  });

  it('normalizes non-string names and fixed-rate caps', () => {
    const service = new CommissionService(db);
    expect(() => service.createRule({ name: 123 as never, rateType: 'PERCENT', rate: 1 }, context))
      .toThrow('规则名称不能为空');
    expect(() => service.createRule({ name: 'x', rateType: 'FIXED', rate: 1_000_000_000_001 }, context))
      .toThrow('固定提成金额超过上限');
  });
});
