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

  it('deserializes nullable rule metadata and malformed statement breakdowns', () => {
    const globalContext: AppContext = { ...context, clinicId: null };
    db.prepare(
      `INSERT INTO CommissionRule (
         id, clinicId, name, category, costType, rateType, rate, doctorId, enabled,
         createdAt, updatedAt, deletedAt
       ) VALUES (?, NULL, 'Global Rule', NULL, NULL, 'PERCENT', 0, NULL, 1, ?, ?, NULL)`,
    ).run('rule-null-metadata', now, now);
    expect(new CommissionService(db).listRules(globalContext).find((rule) => rule.id === 'rule-null-metadata'))
      .toMatchObject({ clinicId: null, category: null, costType: null, doctorId: null, enabled: 1 });

    db.prepare(
      `INSERT INTO CommissionStatement (
         id, clinicId, period, doctorId, totalCharged, totalCommission, breakdownJson, calculatedAt, deletedAt
       ) VALUES (?, NULL, '2026-08', 'user-doctor-commission', 0, 0, 'not-json', ?, NULL)`,
    ).run('stmt-null-metadata', now);
    const statement = new CommissionService(db).statements('2026-08', globalContext)
      .find((row) => row.id === 'stmt-null-metadata');
    expect(statement).toMatchObject({ breakdown: [], totalCharged: 0, totalCommission: 0 });
  });

  it('merges explicit undefined, null, and empty-string patches on update', () => {
    const service = new CommissionService(db);
    const created = service.createRule(
      { name: 'X', category: 'A', costType: 'SERVICE', doctorId: 'user-doctor-commission', enabled: false, rateType: 'PERCENT', rate: 100 },
      context,
    );
    // 显式 undefined 保留现有值；null/'' 清空；省略 enabled 保持禁用
    const merged = service.updateRule(created.id, {
      category: undefined,
      costType: null,
      doctorId: '',
      rate: 200,
    }, context);
    expect(merged.category).toBe('A');
    expect(merged.costType).toBeNull();
    expect(merged.doctorId).toBeNull();
    expect(merged.enabled).toBe(0);
    expect(merged.rate).toBe(200);
    expect(service.listRules(context).find((rule) => rule.id === created.id)?.enabled).toBe(0);
  });

  it('accepts boundary rates and trims names and categories', () => {
    const service = new CommissionService(db);
    expect(() => service.createRule({ name: 'x', rateType: 'PERCENT', rate: 0 }, context)).not.toThrow();
    expect(service.createRule({ name: 'F', rateType: 'FIXED', rate: 1_000_000_000_000 }, context).rate)
      .toBe(1_000_000_000_000);
    expect(service.createRule({ name: 'P', rateType: 'PERCENT', rate: 10_000 }, context).rate).toBe(10_000);
    const trimmed = service.createRule({ name: '  规则A  ', category: '  EXAM  ', rateType: 'PERCENT', rate: 1 }, context);
    expect(trimmed.name).toBe('规则A');
    expect(trimmed.category).toBe('EXAM');
    expect(service.createRule({ name: 'B', category: '', rateType: 'PERCENT', rate: 1 }, context).category).toBeNull();
    expect(() => service.createRule({ name: '   ', rateType: 'PERCENT', rate: 1 }, context)).toThrow('规则名称不能为空');
  });

  it('matches each rule tier when more specific rules are absent', () => {
    const service = new CommissionService(db);
    // 医生 A：专属 [类型 → 兜底]，顺序由 createdAt 保证
    service.createRule({ name: 'a-type', doctorId: 'user-doctor-commission', costType: 'MATERIAL', rateType: 'PERCENT', rate: 300 }, context);
    service.createRule({ name: 'a-all', doctorId: 'user-doctor-commission', rateType: 'PERCENT', rate: 100 }, context);
    // 医生 B：专属 [仅类别 → 精确]
    service.createRule({ name: 'b-cat', doctorId: 'user-doctor-commission-2', category: 'EXAM', rateType: 'PERCENT', rate: 200 }, context);
    service.createRule({ name: 'b-exact', doctorId: 'user-doctor-commission-2', category: 'TREATMENT', costType: 'SERVICE', rateType: 'PERCENT', rate: 400 }, context);

    insertCharge('charge-comm-tier-1', 'user-doctor-commission', '2026-08-04T09:00:00.000Z', { totalAmount: 10_000 });
    insertItem('charge-comm-tier-1', 'item-tier-1', 'OTHER', 'MATERIAL', 10_000); // 类型层 → 300
    insertCharge('charge-comm-tier-2', 'user-doctor-commission', '2026-08-04T10:00:00.000Z', { totalAmount: 10_000 });
    insertItem('charge-comm-tier-2', 'item-tier-2', 'OTHER', 'SERVICE', 10_000); // 兜底层 → 100
    insertCharge('charge-comm-tier-3', 'user-doctor-commission-2', '2026-08-04T11:00:00.000Z', { totalAmount: 10_000 });
    insertItem('charge-comm-tier-3', 'item-tier-3', 'EXAM', 'MATERIAL', 10_000); // 类别层 → 200
    insertCharge('charge-comm-tier-4', 'user-doctor-commission-2', '2026-08-04T12:00:00.000Z', { totalAmount: 10_000 });
    insertItem('charge-comm-tier-4', 'item-tier-4', 'TREATMENT', 'SERVICE', 10_000); // 精确层 → 400

    const statements = service.calculate('2026-08', context);
    expect(statements.find((row) => row.doctorId === 'user-doctor-commission')?.totalCommission).toBe(400);
    expect(statements.find((row) => row.doctorId === 'user-doctor-commission-2')?.totalCommission).toBe(600);
  });

  it('skips charges without items and floors shares for zero-subtotal items', () => {
    const service = new CommissionService(db);
    service.createRule({ name: 'S', rateType: 'PERCENT', rate: 10_000 }, context);
    // 无明细的收费：该医生不产生任何提成行
    insertCharge('charge-comm-noitem', 'user-doctor-commission-2', '2026-08-04T09:00:00.000Z', { totalAmount: 10_000 });
    // 零小计明细 + costType NULL：floor(effectivePaid / 2) 分摊，costType 回退 'SERVICE'
    insertCharge('charge-comm-zero', 'user-doctor-commission', '2026-08-04T09:00:00.000Z', { totalAmount: 300, paidAmount: 300 });
    insertItem('charge-comm-zero', 'item-zero-1', 'TREATMENT', null as unknown as string, 0);
    insertItem('charge-comm-zero', 'item-zero-2', 'TREATMENT', 'MATERIAL', 0);

    const statements = service.calculate('2026-08', context);
    expect(statements.some((row) => row.doctorId === 'user-doctor-commission-2')).toBe(false);
    const statement = statements.find((row) => row.doctorId === 'user-doctor-commission');
    expect(statement?.totalCharged).toBe(300);
    expect(statement?.breakdown?.reduce((sum, line) => sum + line.charged, 0)).toBe(300);
    expect(statement?.breakdown?.some((line) => line.costType === 'SERVICE' && line.charged === 150)).toBe(true);
  });

  it('drops lines whose share rounds down to zero', () => {
    const service = new CommissionService(db);
    service.createRule({ name: 'S', rateType: 'PERCENT', rate: 10_000 }, context);
    insertCharge('charge-comm-one', 'user-doctor-commission', '2026-08-04T09:00:00.000Z', { totalAmount: 1, paidAmount: 1 });
    insertItem('charge-comm-one', 'item-one-1', 'TREATMENT', 'SERVICE', 1);
    insertItem('charge-comm-one', 'item-one-2', 'TREATMENT', 'SERVICE', 1);

    const statement = service.calculate('2026-08', context).find((row) => row.doctorId === 'user-doctor-commission');
    expect(statement?.totalCharged).toBe(1);
    expect(statement?.breakdown).toHaveLength(1);
    expect(statement?.breakdown?.[0].charged).toBe(1);
  });

  it('ignores disabled rules and enforces the total commission cap', () => {
    const service = new CommissionService(db);
    // 禁用专属规则不生效，落到启用的默认规则
    service.createRule({ name: 'disabled-spec', doctorId: 'user-doctor-commission', rateType: 'PERCENT', rate: 10_000, enabled: false }, context);
    service.createRule({ name: 'enabled-default', rateType: 'PERCENT', rate: 500 }, context);
    insertCharge('charge-comm-dis', 'user-doctor-commission', '2026-08-04T09:00:00.000Z', { totalAmount: 10_000 });
    insertItem('charge-comm-dis', 'item-comm-dis', 'TREATMENT', 'SERVICE', 10_000);
    const statement = service.calculate('2026-08', context).find((row) => row.doctorId === 'user-doctor-commission');
    expect(statement?.totalCommission).toBe(500);
  });

  it('accepts a single capped fixed rate and rejects totals beyond the cap', () => {
    const service = new CommissionService(db);
    service.createRule({ name: 'fixed-max', rateType: 'FIXED', rate: 1_000_000_000_000 }, context);
    insertCharge('charge-comm-cap-1', 'user-doctor-commission-2', '2026-08-04T09:00:00.000Z', { totalAmount: 10_000 });
    insertItem('charge-comm-cap-1', 'item-cap-1', 'TREATMENT', 'SERVICE', 10_000);
    const single = service.calculate('2026-08', context).find((row) => row.doctorId === 'user-doctor-commission-2');
    expect(single?.totalCommission).toBe(1_000_000_000_000);

    insertCharge('charge-comm-cap-2', 'user-doctor-commission-2', '2026-08-04T10:00:00.000Z', { totalAmount: 10_000 });
    insertItem('charge-comm-cap-2', 'item-cap-2', 'TREATMENT', 'SERVICE', 10_000);
    expect(() => service.calculate('2026-08', context)).toThrow('提成总额超过上限');
  });

  it('validates period month boundaries', () => {
    const service = new CommissionService(db);
    expect(() => service.statements('2026-00', context)).toThrow('月份必须在 01-12');
    expect(() => service.statements('2026-13', context)).toThrow('月份必须在 01-12');
    expect(() => service.calculate('2026-0', context)).toThrow('period 格式应为 YYYY-MM');
    expect(service.calculate('2026-12', context)).toEqual([]);
  });

  it('filters statements by doctorId for administrators', () => {
    const service = new CommissionService(db);
    service.createRule({ name: 'S', rateType: 'PERCENT', rate: 500 }, context);
    insertCharge('charge-comm-f1', 'user-doctor-commission', '2026-08-04T09:00:00.000Z', { totalAmount: 10_000 });
    insertItem('charge-comm-f1', 'item-f1', 'TREATMENT', 'SERVICE', 10_000);
    insertCharge('charge-comm-f2', 'user-doctor-commission-2', '2026-08-04T09:00:00.000Z', { totalAmount: 10_000 });
    insertItem('charge-comm-f2', 'item-f2', 'TREATMENT', 'SERVICE', 10_000);
    service.calculate('2026-08', context);

    const filtered = service.statements('2026-08', context, { doctorId: 'user-doctor-commission' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].doctorId).toBe('user-doctor-commission');
  });
});
