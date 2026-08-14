import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { MemberDiscountService } from './member-discount';
import { MemberCardService } from './financial';

describe('MemberDiscountService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-member-discount-'));
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
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function createCard(cardNo: string, patientId = 'patient-demo-001'): string {
    return String(new MemberCardService(db).create({ patientId, cardNo, status: 'ACTIVE', level: 'NORMAL' }, context).id);
  }

  function rawInsertCharge(
    id: string,
    overrides: {
      discount?: number;
      createdAt?: string;
      patientId?: string;
      clinicId?: string;
      deletedAt?: string | null;
    } = {},
  ): void {
    db.prepare(
      `INSERT INTO Charge (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, number, totalAmount, discount, status
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PAID')`,
    ).run(
      id,
      overrides.clinicId ?? 'clinic-v2-001',
      overrides.createdAt ?? '2026-03-01T10:00:00.000Z',
      overrides.createdAt ?? '2026-03-01T10:00:00.000Z',
      overrides.deletedAt === undefined ? null : overrides.deletedAt,
      overrides.patientId ?? 'patient-demo-001',
      `CHG-${id}`,
      100000,
      overrides.discount ?? 0,
    );
  }

  it('savePlan persists a full plan and getPlan reads it back', () => {
    const cardId = createCard('MD-CARD-1');
    const service = new MemberDiscountService(db);
    const saved = service.savePlan(cardId, {
      discountRate: 90,
      maxDiscountAmount: 50000,
      roundingMode: 'ROUND',
      annualDiscountLimit: 200000,
      specialDiscountsJson: [
        { name: '隐形矫正', category: 'ORTHODONTIC', rate: 90 },
        { name: '种植', category: 'IMPLANT', rate: 85 },
      ],
    }, context);
    expect(saved).toEqual({
      id: cardId,
      cardNo: 'MD-CARD-1',
      discountRate: 90,
      maxDiscountAmount: 50000,
      roundingMode: 'ROUND',
      annualDiscountLimit: 200000,
      specialDiscountsJson: [
        { name: '隐形矫正', category: 'ORTHODONTIC', rate: 90 },
        { name: '种植', category: 'IMPLANT', rate: 85 },
      ],
    });

    const row = db.prepare('SELECT * FROM MemberCard WHERE id = ?').get(cardId) as Record<string, unknown>;
    expect(row.discountRate).toBe(90);
    expect(row.maxDiscountAmount).toBe(50000);
    expect(row.roundingMode).toBe('ROUND');
    expect(row.annualDiscountLimit).toBe(200000);
    expect(row.specialDiscountsJson).toBe(JSON.stringify([
      { name: '隐形矫正', category: 'ORTHODONTIC', rate: 90 },
      { name: '种植', category: 'IMPLANT', rate: 85 },
    ]));
    expect(row.updatedAt).toBe(now);

    expect(service.getPlan(cardId, context)).toEqual({
      id: cardId,
      cardNo: 'MD-CARD-1',
      discountRate: 90,
      maxDiscountAmount: 50000,
      roundingMode: 'ROUND',
      annualDiscountLimit: 200000,
      specialDiscountsJson: [
        { name: '隐形矫正', category: 'ORTHODONTIC', rate: 90 },
        { name: '种植', category: 'IMPLANT', rate: 85 },
      ],
    });
  });

  it('savePlan with null fields clears the plan', () => {
    const cardId = createCard('MD-CARD-2');
    const service = new MemberDiscountService(db);
    service.savePlan(cardId, {
      discountRate: 80,
      maxDiscountAmount: 10000,
      roundingMode: 'FLOOR',
      annualDiscountLimit: 50000,
      specialDiscountsJson: [{ name: 'x', category: 'Y', rate: 95 }],
    }, context);
    service.savePlan(cardId, {
      discountRate: null,
      maxDiscountAmount: null,
      roundingMode: null,
      annualDiscountLimit: null,
      specialDiscountsJson: null,
    }, context);
    expect(service.getPlan(cardId, context)).toEqual({
      id: cardId,
      cardNo: 'MD-CARD-2',
      discountRate: null,
      maxDiscountAmount: null,
      roundingMode: null,
      annualDiscountLimit: null,
      specialDiscountsJson: null,
    });
  });

  it('quote applies the base discount rate with FLOOR rounding', () => {
    const cardId = createCard('MD-CARD-3');
    const service = new MemberDiscountService(db);
    service.savePlan(cardId, { discountRate: 90, roundingMode: 'FLOOR' }, context);
    const result = service.quote(cardId, { baseTotal: 15000 }, context);
    expect(result).toEqual({
      cardId,
      cardNo: 'MD-CARD-3',
      patientId: 'patient-demo-001',
      applied: true,
      baseTotal: 15000,
      discount: 1500,
      total: 13500,
      roundingMode: 'FLOOR',
      breakdown: [],
      annualUsage: 0,
      annualRemaining: null,
    });
  });

  it('quote matches special categories per item and accumulates the breakdown', () => {
    const cardId = createCard('MD-CARD-4');
    const service = new MemberDiscountService(db);
    service.savePlan(cardId, {
      discountRate: null,
      specialDiscountsJson: [
        { name: '隐形矫正', category: 'ORTHODONTIC', rate: 90 },
        { name: '种植', category: 'IMPLANT', rate: 85 },
      ],
    }, context);
    const result = service.quote(cardId, {
      baseTotal: 35000,
      items: [
        { category: 'ORTHODONTIC', subtotal: 10000 },
        { category: 'ORTHODONTIC', subtotal: 20000 },
        { category: 'CLEANING', subtotal: 5000 },
      ],
    }, context);
    expect(result.discount).toBe(3000);
    expect(result.total).toBe(32000);
    expect(result.breakdown).toEqual([
      { category: 'ORTHODONTIC', rate: 90, subtotal: 10000, discount: 1000 },
      { category: 'ORTHODONTIC', rate: 90, subtotal: 20000, discount: 2000 },
      { category: 'CLEANING', rate: 100, subtotal: 5000, discount: 0 },
    ]);
    expect(result.roundingMode).toBe('FLOOR');
  });

  it('quote caps the discount by maxDiscountAmount', () => {
    const cardId = createCard('MD-CARD-5');
    const service = new MemberDiscountService(db);
    service.savePlan(cardId, { discountRate: 90, maxDiscountAmount: 5000 }, context);
    const result = service.quote(cardId, { baseTotal: 100000 }, context);
    expect(result.discount).toBe(5000);
    expect(result.total).toBe(95000);
  });

  it('quote consumes the annual limit based on the current-year usage', () => {
    const cardId = createCard('MD-CARD-6');
    const service = new MemberDiscountService(db);
    service.savePlan(cardId, { discountRate: 90, annualDiscountLimit: 10000 }, context);
    rawInsertCharge('chg-same-year', { discount: 6000 });
    rawInsertCharge('chg-last-year', { discount: 8000, createdAt: '2025-06-01T10:00:00.000Z' });
    rawInsertCharge('chg-deleted', { discount: 5000, createdAt: '2026-04-01T10:00:00.000Z', deletedAt: '2026-05-01T10:00:00.000Z' });
    rawInsertCharge('chg-zero', { discount: 0, createdAt: '2026-04-01T10:00:00.000Z' });
    rawInsertCharge('chg-other-clinic', { discount: 3000, createdAt: '2026-04-01T10:00:00.000Z', clinicId: 'clinic-other' });

    const result = service.quote(cardId, { baseTotal: 100000 }, context);
    expect(result.annualUsage).toBe(6000);
    expect(result.annualRemaining).toBe(4000);
    expect(result.discount).toBe(4000);
    expect(result.total).toBe(96000);
  });

  it('annual usage 按诊所时区（+8）归属年份，UTC 跨年边界计入本地年', () => {
    const cardId = createCard('MD-CARD-YR');
    const service = new MemberDiscountService(db);
    service.savePlan(cardId, { discountRate: 90, annualDiscountLimit: 10000 }, context);
    // 年度统计按 patientId 聚合，前面用例已产生基线用量；用 delta 断言排除测试间干扰
    const before = service.quote(cardId, { baseTotal: 100000 }, context).annualUsage as number;
    // UTC 2025-12-31T16:30:00Z = 诊所本地 2026-01-01 00:30（+8）：应计入 2026 年
    rawInsertCharge('chg-year-boundary', { discount: 6000, createdAt: '2025-12-31T16:30:00.000Z' });
    // UTC 2025-12-31T15:59:59Z = 诊所本地 2025-12-31 23:59:59：仍属 2025 年，不计入
    rawInsertCharge('chg-year-prev', { discount: 8000, createdAt: '2025-12-31T15:59:59.000Z' });

    const result = service.quote(cardId, { baseTotal: 100000 }, context);
    expect(result.annualUsage).toBe(before + 6000);
    expect(result.annualRemaining).toBe(Math.max(0, 10000 - (before + 6000)));
  });

  it('quote applies FLOOR / ROUND / NONE rounding to the raw total', () => {
    const service = new MemberDiscountService(db);
    const floorId = createCard('MD-CARD-7A');
    const roundId = createCard('MD-CARD-7B');
    const noneId = createCard('MD-CARD-7C');
    service.savePlan(floorId, { discountRate: 90, roundingMode: 'FLOOR' }, context);
    service.savePlan(roundId, { discountRate: 90, roundingMode: 'ROUND' }, context);
    service.savePlan(noneId, { discountRate: 90, roundingMode: 'NONE' }, context);

    const floor = service.quote(floorId, { baseTotal: 15099 }, context);
    const round = service.quote(roundId, { baseTotal: 15099 }, context);
    const none = service.quote(noneId, { baseTotal: 15099 }, context);
    // rawDiscount = round(15099 * 10%) = 1510 → rawTotal 13589
    expect(floor.total).toBe(13500);
    expect(floor.discount).toBe(1599);
    expect(round.total).toBe(13600);
    expect(round.discount).toBe(1499);
    expect(none.total).toBe(13589);
    expect(none.discount).toBe(1510);
  });

  it('quote returns NO_PLAN when the card has neither a base rate nor special discounts', () => {
    const cardId = createCard('MD-CARD-8');
    const service = new MemberDiscountService(db);
    const result = service.quote(cardId, { baseTotal: 12345 }, context);
    expect(result).toEqual({
      cardId,
      cardNo: 'MD-CARD-8',
      applied: false,
      baseTotal: 12345,
      discount: 0,
      total: 12345,
      reason: 'NO_PLAN',
    });
  });

  it('quote validates baseTotal and item subtotals', () => {
    const cardId = createCard('MD-CARD-9');
    const service = new MemberDiscountService(db);
    service.savePlan(cardId, { discountRate: 90 }, context);
    expect(() => service.quote(cardId, { baseTotal: -1 }, context)).toThrow(ValidationError);
    expect(() => service.quote(cardId, { baseTotal: 1.5 }, context)).toThrow(ValidationError);
    expect(() => service.quote(cardId, { baseTotal: Number.MAX_SAFE_INTEGER + 1 }, context)).toThrow(ValidationError);
    expect(() => service.quote(cardId, { baseTotal: 100, items: [{ subtotal: -1 }] }, context)).toThrow(ValidationError);
    expect(() => service.quote(cardId, { baseTotal: 100, items: [{ subtotal: 1.5 }] }, context)).toThrow(ValidationError);
  });

  it('savePlan rejects non-object special discount entries', () => {
    const cardId = createCard('MD-CARD-ENTRY');
    const service = new MemberDiscountService(db);
    expect(() => service.savePlan(cardId, { specialDiscountsJson: [42] }, context)).toThrow('特殊项目折扣格式无效');
    expect(() => service.savePlan(cardId, { specialDiscountsJson: [null] }, context)).toThrow('特殊项目折扣格式无效');
  });

  it('getPlan normalizes a whitespace-only stored JSON to null', () => {
    const cardId = createCard('MD-CARD-SPACE');
    const service = new MemberDiscountService(db);
    db.prepare('UPDATE MemberCard SET specialDiscountsJson = ? WHERE id = ?').run('   ', cardId);
    expect(service.getPlan(cardId, context).specialDiscountsJson).toBeNull();
  });

  it('quote rejects a non-array items value and non-object items', () => {
    const cardId = createCard('MD-CARD-ITEMS');
    const service = new MemberDiscountService(db);
    service.savePlan(cardId, { discountRate: 90 }, context);
    expect(() => service.quote(cardId, { baseTotal: 100, items: 'oops' as never }, context)).toThrow('报价项目无效');
    expect(() => service.quote(cardId, { baseTotal: 100, items: [42 as never] }, context)).toThrow('报价项目无效');
  });

  it('quote falls back to an empty category when an item omits it', () => {
    const cardId = createCard('MD-CARD-NOCAT');
    const service = new MemberDiscountService(db);
    service.savePlan(cardId, { discountRate: 90, roundingMode: 'NONE' }, context);
    const result = service.quote(cardId, { baseTotal: 1000, items: [{ subtotal: 100 }] }, context);
    expect(result.breakdown).toEqual([{ category: '', rate: 90, subtotal: 100, discount: 10 }]);
    expect(result.discount).toBe(10);
    expect(result.total).toBe(990);
  });

  it('quote with specials only and no items applies the 100 default rate', () => {
    const cardId = createCard('MD-CARD-SPECIAL-ONLY');
    const service = new MemberDiscountService(db);
    service.savePlan(cardId, {
      specialDiscountsJson: [{ name: '种植', category: 'IMPLANT', rate: 85 }],
    }, context);
    // 无 items 明细时走整体折扣路径：rate 兜底 100 → 不打折但 applied 为 true。
    const result = service.quote(cardId, { baseTotal: 20000 }, context);
    expect(result.applied).toBe(true);
    expect(result.discount).toBe(0);
    expect(result.total).toBe(20000);
  });

  it('quote never returns a negative total when item subtotals exceed the base total', () => {
    const cardId = createCard('MD-CARD-CLAMP');
    const service = new MemberDiscountService(db);
    service.savePlan(cardId, { discountRate: 50, roundingMode: 'FLOOR' }, context);
    // 明细小计 20000，但调用方传入 baseTotal=100；折扣按明细计算会超过原价，
    // 修复后总价与优惠都必须落回 [0, baseTotal]。
    const result = service.quote(cardId, {
      baseTotal: 100,
      items: [{ category: 'IMPLANT', subtotal: 20000 }],
    }, context);
    expect(result.total).toBe(0);
    expect(result.discount).toBe(100);
  });

  it('quote validates baseTotal even when the card has no discount plan', () => {
    const cardId = createCard('MD-CARD-NOPLAN');
    const service = new MemberDiscountService(db);
    expect(() => service.quote(cardId, { baseTotal: 1.5 }, context)).toThrow(ValidationError);
    expect(() => service.quote(cardId, { baseTotal: -10 }, context)).toThrow(ValidationError);
    expect(service.quote(cardId, { baseTotal: 0 }, context).applied).toBe(false);
  });

  it('savePlan rejects invalid plan fields', () => {
    const cardId = createCard('MD-CARD-10');
    const service = new MemberDiscountService(db);
    expect(() => service.savePlan(cardId, { discountRate: 101 }, context)).toThrow('折扣率必须为 0-100 的整数');
    expect(() => service.savePlan(cardId, { discountRate: 1.5 }, context)).toThrow(ValidationError);
    expect(() => service.savePlan(cardId, { maxDiscountAmount: -1 }, context)).toThrow(ValidationError);
    expect(() => service.savePlan(cardId, { roundingMode: 'UP' }, context)).toThrow('取整方式无效');
    expect(() => service.savePlan(cardId, { annualDiscountLimit: -5 }, context)).toThrow(ValidationError);
    expect(() => service.savePlan(cardId, { specialDiscountsJson: 'oops' }, context)).toThrow('特殊项目折扣格式无效');
    expect(() => service.savePlan(cardId, { specialDiscountsJson: [{ name: 'x', category: 'Y', rate: 101 }] }, context)).toThrow(ValidationError);
    expect(() => service.savePlan(cardId, { specialDiscountsJson: [{ name: 1, category: 'Y', rate: 90 }] }, context)).toThrow(ValidationError);
    expect(() => service.savePlan(cardId, { specialDiscountsJson: [{ name: 'x', category: 'Y', rate: 1.5 }] }, context)).toThrow(ValidationError);
  });

  it('quoteByPatient quotes through the earliest active card of the patient', () => {
    const service = new MemberDiscountService(db);
    const newerId = createCard('MD-PATIENT-NEW');
    service.savePlan(newerId, { discountRate: 95 }, context);
    const olderId = createCard('MD-PATIENT-OLD');
    db.prepare(
      `UPDATE MemberCard SET createdAt = ?, updatedAt = ? WHERE id = ?`,
    ).run('2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', olderId);
    service.savePlan(olderId, { discountRate: 80 }, context);

    const result = service.quoteByPatient('patient-demo-001', { baseTotal: 10000 }, context);
    expect(result.cardId).toBe(olderId);
    expect(result.applied).toBe(true);
    expect(result.discount).toBe(2000);
    expect(result.total).toBe(8000);
  });

  it('quoteByPatient returns NO_ACTIVE_CARD when the patient has no active card', () => {
    const service = new MemberDiscountService(db);
    db.prepare(
      `INSERT INTO Patient (id, clinicId, createdAt, updatedAt, deletedAt, code, name, gender, active)
       VALUES (?, ?, ?, ?, NULL, 'P002', 'No Card Patient', 'UNKNOWN', 1)`,
    ).run('patient-nocard-001', 'clinic-v2-001', now, now);
    expect(service.quoteByPatient('patient-nocard-001', { baseTotal: 5000 }, context)).toEqual({
      cardId: null,
      applied: false,
      baseTotal: 5000,
      discount: 0,
      total: 5000,
      reason: 'NO_ACTIVE_CARD',
    });

    const inactiveId = createCard('MD-INACTIVE', 'patient-nocard-001');
    db.prepare('UPDATE MemberCard SET status = ? WHERE id = ?').run('INACTIVE', inactiveId);
    expect(service.quoteByPatient('patient-nocard-001', { baseTotal: 5000 }, context).applied).toBe(false);
    expect(service.quoteByPatient('patient-nocard-001', { baseTotal: 5000 }, context).reason).toBe('NO_ACTIVE_CARD');
  });

  it('throws NotFoundError for missing cards and scopes to the clinic', () => {
    const service = new MemberDiscountService(db);
    const otherId = createCard('MD-OTHER-CLINIC');
    db.prepare('UPDATE MemberCard SET clinicId = ? WHERE id = ?').run('clinic-other', otherId);

    expect(() => service.getPlan('missing-card', context)).toThrow(NotFoundError);
    expect(() => service.savePlan('missing-card', { discountRate: 90 }, context)).toThrow(NotFoundError);
    expect(() => service.quote('missing-card', { baseTotal: 100 }, context)).toThrow(NotFoundError);
    expect(() => service.getPlan(otherId, context)).toThrow(NotFoundError);
    expect(() => service.quote(otherId, { baseTotal: 100 }, context)).toThrow(NotFoundError);
  });
});
