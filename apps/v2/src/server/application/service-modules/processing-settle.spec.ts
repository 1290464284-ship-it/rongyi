import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { ProcessingOrderService } from './financial';
import { ProcessingSettleService } from './processing-settle';

describe('ProcessingSettleService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-processing-settle-'));
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
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertOrder(
    id: string,
    overrides: {
      clinicId?: string;
      status?: string;
      settleStatus?: string;
      totalFee?: number;
      settledAmount?: number | null;
      settledAt?: string | null;
      settlementNote?: string | null;
      settlementRef?: string | null;
      deletedAt?: string | null;
    } = {},
  ): void {
    db.prepare(
      `INSERT INTO ProcessingOrder (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalFee, status, settleStatus,
         settledAmount, settledAt, settlementNote, settlementRef
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      overrides.clinicId ?? 'clinic-v2-001',
      now,
      now,
      overrides.deletedAt === undefined ? null : overrides.deletedAt,
      'patient-demo-001',
      `PO-${id}`,
      overrides.totalFee ?? 0,
      overrides.status ?? 'DRAFT',
      overrides.settleStatus ?? 'UNSETTLED',
      overrides.settledAmount === undefined ? null : overrides.settledAmount,
      overrides.settledAt === undefined ? null : overrides.settledAt,
      overrides.settlementNote === undefined ? null : overrides.settlementNote,
      overrides.settlementRef === undefined ? null : overrides.settlementRef,
    );
  }

  function row(id: string): Record<string, unknown> {
    return db.prepare('SELECT * FROM ProcessingOrder WHERE id = ?').get(id) as Record<string, unknown>;
  }

  it('settles a received order end-to-end and clears the fields on unsettle', async () => {
    const service = new ProcessingSettleService(db);
    const orders = new ProcessingOrderService(db);
    const created = await orders.create({
      patientId: 'patient-demo-001',
      number: 'PO-CHAIN-1',
      totalFee: 50000,
      items: [{ name: '烤瓷冠', spec: 'A2', quantity: 1, unitPrice: 50000 }],
    }, context);
    const id = String(created.id);
    expect(orders.transition(id, 'SENT', context)).toEqual({ id, status: 'SENT' });
    expect(orders.transition(id, 'IN_PROGRESS', context)).toEqual({ id, status: 'IN_PROGRESS' });
    expect(orders.transition(id, 'COMPLETED', context)).toEqual({ id, status: 'COMPLETED' });
    expect(orders.transition(id, 'RECEIVED', context)).toEqual({ id, status: 'RECEIVED' });

    const result = service.settle(id, { amount: 50000, ref: '  REF-2026-A  ', note: '月结对账' }, context);
    expect(result).toEqual({ id, settleStatus: 'SETTLED', settledAmount: 50000, settledAt: now });

    const settledRow = row(id);
    expect(settledRow.settleStatus).toBe('SETTLED');
    expect(settledRow.settledAmount).toBe(50000);
    expect(settledRow.settledAt).toBe(now);
    expect(settledRow.settlementNote).toBe('月结对账');
    expect(settledRow.settlementRef).toBe('REF-2026-A');
    expect(settledRow.updatedAt).toBe(now);

    expect(() => service.settle(id, { amount: 50000 }, context)).toThrow(ConflictError);
    expect(() => service.settle(id, { amount: 50000 }, context)).toThrow('加工单已结算');

    expect(service.unsettle(id, context)).toEqual({ id, settleStatus: 'UNSETTLED' });
    const unsettledRow = row(id);
    expect(unsettledRow.settleStatus).toBe('UNSETTLED');
    expect(unsettledRow.settledAmount).toBeNull();
    expect(unsettledRow.settledAt).toBeNull();
    expect(unsettledRow.settlementNote).toBeNull();
    expect(unsettledRow.settlementRef).toBeNull();
    expect(unsettledRow.updatedAt).toBe(now);
  });

  it('rejects settlement of a DRAFT order', () => {
    insertOrder('settle-draft', { status: 'DRAFT', totalFee: 30000 });
    const service = new ProcessingSettleService(db);
    expect(() => service.settle('settle-draft', { amount: 30000 }, context)).toThrow(ValidationError);
    expect(() => service.settle('settle-draft', { amount: 30000 }, context)).toThrow('仅已完成或已收货的加工单可结算');
    expect(row('settle-draft').settleStatus).toBe('UNSETTLED');
  });

  it('rejects unsettle of an order that is not settled', () => {
    insertOrder('settle-not-settled', { status: 'COMPLETED', totalFee: 10000 });
    const service = new ProcessingSettleService(db);
    expect(() => service.unsettle('settle-not-settled', context)).toThrow(ConflictError);
    expect(() => service.unsettle('settle-not-settled', context)).toThrow('加工单未结算');
  });

  it('throws NotFoundError for missing or out-of-tenant orders', () => {
    insertOrder('settle-other-clinic', { status: 'COMPLETED', totalFee: 10000, clinicId: 'clinic-other' });
    const service = new ProcessingSettleService(db);
    expect(() => service.settle('settle-missing', { amount: 1 }, context)).toThrow(NotFoundError);
    expect(() => service.settle('settle-missing', { amount: 1 }, context)).toThrow('Processing order not found');
    expect(() => service.settle('settle-other-clinic', { amount: 1 }, context)).toThrow(NotFoundError);
    expect(() => service.unsettle('settle-missing', context)).toThrow(NotFoundError);
  });

  it('validates the settlement amount as a non-negative safe integer in cents', () => {
    insertOrder('settle-amount', { status: 'COMPLETED', totalFee: 20000 });
    const service = new ProcessingSettleService(db);
    expect(() => service.settle('settle-amount', { amount: -1 }, context)).toThrow(ValidationError);
    expect(() => service.settle('settle-amount', { amount: 12.5 }, context)).toThrow(ValidationError);
    expect(() => service.settle('settle-amount', { amount: Number.NaN }, context)).toThrow(ValidationError);
    expect(() => service.settle('settle-amount', { amount: '100' as unknown as number }, context)).toThrow(ValidationError);
    expect(row('settle-amount').settleStatus).toBe('UNSETTLED');

    const zero = service.settle('settle-amount', { amount: 0, note: '   ' }, context);
    expect(zero.settledAmount).toBe(0);
    expect(row('settle-amount').settlementNote).toBeNull();
  });

  it('computes settlement stats excluding cancelled and other-tenant orders', () => {
    db.prepare('DELETE FROM ProcessingOrder').run();
    insertOrder('stats-u1', { status: 'COMPLETED', settleStatus: 'UNSETTLED', totalFee: 10000 });
    insertOrder('stats-u2', { status: 'RECEIVED', settleStatus: 'UNSETTLED', totalFee: 20000 });
    insertOrder('stats-c1', { status: 'CANCELLED', settleStatus: 'UNSETTLED', totalFee: 99999 });
    insertOrder('stats-s1', { status: 'RECEIVED', settleStatus: 'SETTLED', totalFee: 30000, settledAmount: 15000 });
    insertOrder('stats-s2', { status: 'COMPLETED', settleStatus: 'SETTLED', totalFee: 30000, settledAmount: 25000 });
    insertOrder('stats-other', { status: 'COMPLETED', settleStatus: 'UNSETTLED', totalFee: 77777, clinicId: 'clinic-other' });
    insertOrder('stats-deleted', { status: 'COMPLETED', settleStatus: 'UNSETTLED', totalFee: 55555, deletedAt: now });

    const service = new ProcessingSettleService(db);
    expect(service.stats(context)).toEqual({
      unsettled: { count: 2, feeTotal: 30000 },
      settled: { count: 2, amountTotal: 40000 },
    });

    db.prepare('DELETE FROM ProcessingOrder').run();
    expect(service.stats(context)).toEqual({
      unsettled: { count: 0, feeTotal: 0 },
      settled: { count: 0, amountTotal: 0 },
    });
  });
});
