/**
 * 治疗计划折扣与收费联动：
 * - 整单折（NONE/WHOLE/DOUBLE）与单条折扣（明细级 discountRate）
 * - 计划收费联动（bill：勾选明细 → 生成 Charge + ChargeItem 划价单）
 * - 已划价明细不可改价 / 不可重复划价
 * - 计划回访追踪（followUpStatus / nextFollowUpAt / trackingNote）
 *
 * 遵循服务模块约定：构造收 db，租户过滤用 tenantAnd/tenantParams，
 * 错误用 infrastructure/errors 的 NotFoundError/ConflictError/ValidationError，
 * context 用 domain/contracts 的 AppContext。金额单位：分（整数），Math.round 取整。
 */
import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { trackResourceWrite } from '../../infrastructure/write-tracking';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { generateDocumentNumber } from './common';
import type { AppContext } from '../../../domain/contracts';

const PLAN_DISCOUNT_TYPES = new Set(['NONE', 'WHOLE', 'DOUBLE']);
const FOLLOW_UP_STATUSES = new Set(['NONE', 'PENDING', 'HORIZONTAL_SHOULD', 'HORIZONTAL_DONE', 'LOST']);

export interface SetPlanDiscountInput {
  discountType: 'NONE' | 'WHOLE' | 'DOUBLE';
  discountRate?: number;
}

export interface SetItemDiscountInput {
  discountRate: number | null;
}

export interface BillInput {
  itemIds?: string[];
}

export interface PlanFollowUpInput {
  followUpStatus: 'NONE' | 'PENDING' | 'HORIZONTAL_SHOULD' | 'HORIZONTAL_DONE' | 'LOST';
  nextFollowUpAt?: string;
  trackingNote?: string;
}

interface PlanRow {
  id: string;
  patientId: string;
  visitId: string | null;
  doctorId: string | null;
  name: string;
  totalFee: number;
  discountType: string | null;
  discountRate: number | null;
  followUpStatus: string | null;
  nextFollowUpAt: string | null;
  trackingNote: string | null;
}

interface PlanItemRow {
  id: string;
  planId: string;
  code: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers: unknown;
  treatmentId: string | null;
  discountRate: number | null;
  billed: number | null;
}

/** 计划折扣率：discountType 为 NONE 或无折扣时按 0 处理。 */
function planRate(plan: { discountType: string | null; discountRate: number | null }): number {
  if (plan.discountType === 'NONE' || plan.discountType === null || plan.discountType === undefined) return 0;
  return Number(plan.discountRate ?? 0);
}

/** 明细有效单价 = price；有明细折扣时 = Math.round(price * (1 - rate/100))。 */
function effectivePrice(item: { price: number; discountRate: number | null }): number {
  if (item.discountRate === null || item.discountRate === undefined) return Number(item.price);
  return Math.round(Number(item.price) * (1 - Number(item.discountRate) / 100));
}

/** 明细小计 = 有效单价 * quantity（Math.round 取整为分）。 */
function itemSubtotal(item: { price: number; quantity: number; discountRate: number | null }): number {
  return Math.round(effectivePrice(item) * Number(item.quantity));
}

/** 计划总价 = Math.round(Σ 明细小计 * (1 - 计划折扣率/100))。 */
function planTotal(items: PlanItemRow[], rate: number): number {
  const subtotalSum = items.reduce((sum, item) => sum + itemSubtotal(item), 0);
  return Math.round(subtotalSum * (1 - rate / 100));
}

function validateDiscountRate(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new ValidationError('折扣率须在 0-100 之间');
  }
  return value;
}

/** 明细 teethNumbers 在库中为 JSON 字符串；归一后重新序列化，避免双重编码。 */
function storedTeethNumbers(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value));
    } catch {
      return '[]';
    }
  }
  return JSON.stringify(value ?? []);
}

export class TreatmentPlanBillingService {
  constructor(private readonly db: Database.Database) {}

  setPlanDiscount(
    planId: string,
    input: SetPlanDiscountInput,
    context: AppContext,
  ): { id: string; discountType: string; discountRate: number | null; totalFee: number } {
    this.findPlan(planId, context); // 校验计划存在且属于当前租户（plan 变量本身此处用不到）
    const billedItem = this.db.prepare(
      `SELECT 1 FROM TreatmentPlanItem
       WHERE planId = ? AND billed = 1 AND deletedAt IS NULL${tenantAnd(context.clinicId)}
       LIMIT 1`,
    ).get(planId, ...tenantParams(context.clinicId));
    if (billedItem) {
      throw new ConflictError('治疗计划已划价，整单折扣不可修改');
    }
    const discountType = input?.discountType;
    if (typeof discountType !== 'string' || !PLAN_DISCOUNT_TYPES.has(discountType)) {
      throw new ValidationError('折扣类型无效');
    }
    const discountRate = discountType === 'NONE'
      ? null
      : (() => {
          const rate = validateDiscountRate(input?.discountRate);
          if (rate === null) throw new ValidationError('折扣率须在 0-100 之间');
          return rate;
        })();

    const items = this.listPlanItems(planId, context);
    const totalFee = planTotal(items, planRate({ discountType, discountRate }));

    const now = context.now().toISOString();
    this.db.prepare(
      `UPDATE TreatmentPlan
       SET discountType = ?, discountRate = ?, totalFee = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(discountType, discountRate, totalFee, now, planId, ...tenantParams(context.clinicId));

    return { id: planId, discountType, discountRate, totalFee };
  }

  setItemDiscount(
    planId: string,
    itemId: string,
    input: SetItemDiscountInput,
    context: AppContext,
  ): { itemId: string; discountRate: number | null; planTotalFee: number } {
    const run = this.db.transaction(() => {
    this.findPlan(planId, context);
    const item = this.findPlanItem(planId, itemId, context);
    if (item.billed === 1) {
      throw new ConflictError('已划价明细不可改价');
    }
    const discountRate = validateDiscountRate(input?.discountRate);

    const now = context.now().toISOString();
    const updateResult = this.db.prepare(
      `UPDATE TreatmentPlanItem
       SET discountRate = ?, updatedAt = ?
       WHERE id = ? AND planId = ? AND (billed IS NULL OR billed = 0) AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(discountRate, now, itemId, planId, ...tenantParams(context.clinicId));
    if (Number(updateResult.changes) === 0) throw new ConflictError('已划价明细不可改价');

    const items = this.listPlanItems(planId, context);
    const plan = this.findPlan(planId, context);
    const planTotalFee = planTotal(items, planRate(plan));
    this.db.prepare(
      `UPDATE TreatmentPlan SET totalFee = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(planTotalFee, now, planId, ...tenantParams(context.clinicId));

    return { itemId, discountRate, planTotalFee };
    });
    return run();
  }

  bill(
    planId: string,
    input: BillInput,
    context: AppContext,
  ): { chargeId: string; number: string; totalAmount: number; itemCount: number; billedItemIds: string[] } {
    const plan = this.findPlan(planId, context);

    const items = this.listPlanItems(planId, context);
    let selected: PlanItemRow[];
    if (input?.itemIds === undefined || input.itemIds === null) {
      selected = items;
    } else {
      if (!Array.isArray(input.itemIds)) throw new ValidationError('明细选择格式无效');
      const uniqueIds = [...new Set(input.itemIds)];
      selected = uniqueIds.map((itemId) => this.findPlanItem(planId, itemId, context));
    }
    if (selected.length === 0) {
      throw new ValidationError('请勾选需要划价的明细');
    }
    for (const item of selected) {
      if (item.billed === 1) {
        throw new ConflictError('已划价明细不可重复划价');
      }
    }

    const patient = this.db.prepare(
      `SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(plan.patientId, ...tenantParams(context.clinicId)) as { id: string } | undefined;
    if (!patient) throw new NotFoundError('Patient not found');

    const rate = planRate(plan);
    const subtotalSum = selected.reduce((sum, item) => sum + itemSubtotal(item), 0);
    const originalSum = selected.reduce((sum, item) => sum + Number(item.price) * Number(item.quantity), 0);
    const totalAmount = Math.round(subtotalSum * (1 - rate / 100));
    const discount = Math.round(originalSum) - totalAmount;

    const now = context.now().toISOString();
    const chargeId = randomUUID();
    const number = generateDocumentNumber('CHG');
    const clinicId = context.clinicId ?? null;

    // ChargeItem.treatmentId 带指向 Treatment 的外键；计划明细的 treatmentId
    // 仅当其真实指向某条 Treatment 记录时才能写入，否则置 NULL（追溯经
    // TreatmentPlanItem.billedChargeId 完成），避免外键违规与全局外键开关。
    const existingTreatmentIds = new Set<string>();
    for (const item of selected) {
      if (!item.treatmentId || typeof item.treatmentId !== 'string') continue;
      if (existingTreatmentIds.has(item.treatmentId)) continue;
      const row = this.db.prepare(
        `SELECT id FROM Treatment WHERE id = ?${tenantAnd(context.clinicId)}`,
      ).get(item.treatmentId, ...tenantParams(context.clinicId)) as { id: string } | undefined;
      if (row) existingTreatmentIds.add(item.treatmentId);
    }
    const run = this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO Charge (
           id, clinicId, createdAt, updatedAt, deletedAt,
           patientId, visitId, doctorId, number, totalAmount, paidAmount, refundedAmount,
           discount, status, payMethod, payMethodName, paidAt, memberCardId, remark,
           discountPlanSnapshotJson
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, 0, 0, ?, 'UNPAID', NULL, NULL, NULL, NULL, ?, '{}')`,
      ).run(
        chargeId,
        clinicId,
        now,
        now,
        plan.patientId,
        plan.visitId ?? null,
        plan.doctorId ?? null,
        number,
        totalAmount,
        discount,
        `治疗计划划价：${plan.name}`,
      );
      // 直写 Charge：统一维护同步与搜索索引。
      trackResourceWrite(this.db, { tableName: 'Charge', recordId: chargeId, operation: 'INSERT', clinicId: context.clinicId });
      const insertItem = this.db.prepare(
        `INSERT INTO ChargeItem (
           id, chargeId, treatmentId, name, category, price, quantity, teethNumbers, subtotal,
           costType, clinicId, createdAt, updatedAt, deletedAt
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'SERVICE', ?, ?, ?, NULL)`,
      );
      for (const item of selected) {
        insertItem.run(
          randomUUID(),
          chargeId,
          existingTreatmentIds.has(String(item.treatmentId)) ? String(item.treatmentId) : null,
          item.name,
          item.category,
          effectivePrice(item),
          item.quantity,
          storedTeethNumbers(item.teethNumbers),
          itemSubtotal(item),
          clinicId,
          now,
          now,
        );
      }
      const updateItem = this.db.prepare(
        `UPDATE TreatmentPlanItem
         SET billed = 1, billedChargeId = ?, updatedAt = ?
         WHERE id = ? AND planId = ? AND (billed = 0 OR billed IS NULL) AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      );
      for (const item of selected) {
        const result = updateItem.run(chargeId, now, item.id, planId, ...tenantParams(context.clinicId));
        if (Number(result.changes) === 0) {
          // 并发划价：另一进程已把该明细置为 billed=1，整笔回滚，防止重复生成 Charge。
          throw new ConflictError('已划价明细不可重复划价');
        }
      }
      this.db.prepare(
        `UPDATE TreatmentPlan SET totalFee = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).run(totalAmount, now, planId, ...tenantParams(context.clinicId));
    });
    run();

    return {
      chargeId,
      number,
      totalAmount,
      itemCount: selected.length,
      billedItemIds: selected.map((item) => item.id),
    };
  }

  planFollowUp(
    planId: string,
    input: PlanFollowUpInput,
    context: AppContext,
  ): Record<string, unknown> {
    const plan = this.findPlan(planId, context);
    const followUpStatus = input?.followUpStatus;
    if (typeof followUpStatus !== 'string' || !FOLLOW_UP_STATUSES.has(followUpStatus)) {
      throw new ValidationError('回访状态无效');
    }
    const nextFollowUpAt = input?.nextFollowUpAt === undefined ? plan.nextFollowUpAt : input.nextFollowUpAt;
    const trackingNote = input?.trackingNote === undefined ? plan.trackingNote : input.trackingNote;
    const now = context.now().toISOString();
    this.db.prepare(
      `UPDATE TreatmentPlan
       SET followUpStatus = ?, nextFollowUpAt = ?, trackingNote = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(followUpStatus, nextFollowUpAt, trackingNote, now, planId, ...tenantParams(context.clinicId));
    return this.findPlan(planId, context) as unknown as Record<string, unknown>;
  }

  private findPlan(planId: string, context: AppContext): PlanRow {
    const row = this.db.prepare(
      `SELECT id, patientId, visitId, doctorId, name, totalFee, discountType, discountRate,
              followUpStatus, nextFollowUpAt, trackingNote
       FROM TreatmentPlan
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(planId, ...tenantParams(context.clinicId)) as PlanRow | undefined;
    if (!row) throw new NotFoundError('Treatment plan not found');
    return row;
  }

  private findPlanItem(planId: string, itemId: string, context: AppContext): PlanItemRow {
    const row = this.db.prepare(
      `SELECT id, planId, code, name, category, price, quantity, teethNumbers, treatmentId, discountRate, billed
       FROM TreatmentPlanItem
       WHERE id = ? AND planId = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(itemId, planId, ...tenantParams(context.clinicId)) as PlanItemRow | undefined;
    if (!row) throw new NotFoundError('Treatment plan item not found');
    return row;
  }

  private listPlanItems(planId: string, context: AppContext): PlanItemRow[] {
    return this.db.prepare(
      `SELECT id, planId, code, name, category, price, quantity, teethNumbers, treatmentId, discountRate, billed
       FROM TreatmentPlanItem
       WHERE planId = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}
       ORDER BY createdAt ASC, id ASC`,
    ).all(planId, ...tenantParams(context.clinicId)) as PlanItemRow[];
  }
}
