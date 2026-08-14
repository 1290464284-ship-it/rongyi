// ProcessingOrderService 模块化 spec：自 services-edge.spec.ts（聚合文件）迁移而来。
// 迁移约定：聚合文件按模块逐步拆出后删除（迁移前保持聚合）。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../../infrastructure/database';
import { runMigrations } from '../../../infrastructure/migrations';
import { ProcessingOrderService } from './processing-order.service';
import { ProcessingSettleService } from '../processing-settle';
import type { AppContext } from '../../../../domain/contracts';

describe('ProcessingOrderService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const nullContext: AppContext = {
    userId: 'user-admin-001',
    clinicId: null,
    role: 'BOSS',
    traceId: 'trace-null',
    now: () => new Date(),
  };

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-processing-'));
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

  it('creates processing orders with validation and settles the full chain', async () => {
    const processing = new ProcessingOrderService(db);
    const createdProc = await processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-CREATE',
      totalFee: 500,
      items: [{ name: 'Crown', quantity: 1, unitPrice: 500 }],
    }, context);
    expect(createdProc).toMatchObject({ status: 'DRAFT' });
    // 全新库回归：建单必须显式落 settleStatus='UNSETTLED'，否则对账统计漏计新单。
    const procRow = db.prepare('SELECT settleStatus FROM ProcessingOrder WHERE id = ?').get(String(createdProc.id)) as { settleStatus: string | null };
    expect(procRow.settleStatus).toBe('UNSETTLED');
    await expect(processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-BAD-ITEM',
      totalFee: 1,
      items: [{ name: 'X', quantity: 0, unitPrice: 1 }],
    }, context)).rejects.toThrow('positive quantity');
    const arrayProc = await processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-ARRAY',
      totalFee: 100,
      teethNumbers: ['11'],
      items: [{ name: 'Bracket', quantity: 1, unitPrice: 100 }],
    }, nullContext);
    expect(arrayProc.status).toBe('DRAFT');
    await expect(processing.create({
      patientId: 'patient-demo-001',
      totalFee: 1,
      items: [{ name: 'X', quantity: 1, unitPrice: 1 }],
    } as unknown as Parameters<typeof processing.create>[0], context)).rejects.toThrow('number is required');
    await expect(processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-BAD-NAME',
      totalFee: 1,
      items: [{ name: undefined as unknown as string, quantity: 1, unitPrice: 1 }],
    }, context)).rejects.toThrow('Each processing item requires');
    await expect(processing.create({
      patientId: 'missing-patient',
      number: 'PROC-BAD',
      totalFee: 1,
      items: [{ name: 'X', quantity: 1, unitPrice: 1 }],
    }, context)).rejects.toThrow('Patient not found');
    await expect(processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-BAD-2',
      totalFee: -1,
      items: [{ name: 'X', quantity: 1, unitPrice: 1 }],
    }, context)).rejects.toThrow('non-negative');
    // 加工单 totalFee 必须是整数分：小数金额不再静默取整（与 unitPrice 校验一致）
    await expect(processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-BAD-FEE-DECIMAL',
      totalFee: 12.5,
      items: [{ name: 'X', quantity: 1, unitPrice: 1 }],
    }, context)).rejects.toThrow('non-negative');
    await expect(processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-BAD-3',
      totalFee: 1,
      items: [],
    }, context)).rejects.toThrow('1 to 500');
    // P0-4：加工项单价必须是整数分，小数单价会导致 subtotal 坏账。
    await expect(processing.create({
      patientId: 'patient-demo-001',
      number: 'PROC-BAD-4',
      totalFee: 1,
      items: [{ name: 'X', quantity: 1, unitPrice: 10.5 }],
    }, context)).rejects.toThrow('unit price');
    // 加工单结算全链路（全新库）：COMPLETED 后结算 → 对账统计计入已结算。
    const procId = String(createdProc.id);
    processing.transition(procId, 'SENT', context);
    processing.transition(procId, 'IN_PROGRESS', context);
    processing.transition(procId, 'COMPLETED', context);
    const settle = new ProcessingSettleService(db);
    expect(settle.settle(procId, { amount: 500 }, context).settleStatus).toBe('SETTLED');
    expect(Number((settle.stats(context) as { settled: { count: number } }).settled.count)).toBeGreaterThanOrEqual(1);
    expect(settle.unsettle(procId, context).settleStatus).toBe('UNSETTLED');
    expect(Number((settle.stats(context) as { unsettled: { count: number } }).unsettled.count)).toBeGreaterThanOrEqual(1);
  });
});
