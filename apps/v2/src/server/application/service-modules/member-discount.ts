/**
 * 会员折扣方案：方案维护（savePlan/getPlan）与报价试算（quote/quoteByPatient）。
 *
 * 遵循服务模块约定：构造收 db，租户过滤用 tenantAnd/tenantParams，
 * 错误用 infrastructure/errors 的 NotFoundError/ValidationError，
 * context 用 domain/contracts 的 AppContext。
 */
import type Database from 'better-sqlite3';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { SystemClock } from '../../infrastructure/clock';
import { CLINIC_TZ_OFFSET_HOURS } from '../../../domain/contracts';
import type { AppContext } from '../../../domain/contracts';

const ROUNDING_MODES = new Set(['FLOOR', 'ROUND', 'NONE']);

interface MemberCardPlanRow {
  id: string;
  patientId: string;
  cardNo: string;
  discountRate: number | null;
  maxDiscountAmount: number | null;
  roundingMode: string | null;
  annualDiscountLimit: number | null;
  specialDiscountsJson: unknown;
}

interface SpecialDiscount {
  name: string;
  category: string;
  rate: number;
}

export interface SavePlanInput {
  discountRate?: number | null;
  maxDiscountAmount?: number | null;
  roundingMode?: string | null;
  annualDiscountLimit?: number | null;
  specialDiscountsJson?: unknown;
}

interface QuoteItem {
  category?: string;
  subtotal: number;
}

export interface QuoteInput {
  baseTotal: number;
  items?: QuoteItem[];
}

function optionalInteger(value: unknown, min: number, max: number, message: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new ValidationError(message);
  }
  return value;
}

function optionalRoundingMode(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !ROUNDING_MODES.has(value)) {
    throw new ValidationError('取整方式无效');
  }
  return value;
}

function optionalSpecialDiscounts(value: unknown): SpecialDiscount[] | null {
  if (value === undefined || value === null) return null;
  if (!Array.isArray(value)) throw new ValidationError('特殊项目折扣格式无效');
  for (const entry of value) {
    if (typeof entry !== 'object' || entry === null) throw new ValidationError('特殊项目折扣格式无效');
    const item = entry as Record<string, unknown>;
    if (typeof item.name !== 'string' || typeof item.category !== 'string') {
      throw new ValidationError('特殊项目折扣格式无效');
    }
    if (typeof item.rate !== 'number' || !Number.isInteger(item.rate) || item.rate < 0 || item.rate > 100) {
      throw new ValidationError('特殊项目折扣格式无效');
    }
  }
  return value as SpecialDiscount[];
}

/** 读取库中存储的特殊折扣（JSON 字符串或 null），空值一律归一为 null。 */
function parseStoredSpecialDiscounts(value: unknown): SpecialDiscount[] | null {
  if (value === null || value === undefined) return null;
  // MemberCard.specialDiscountsJson 为 TEXT 列：入库值恒为 JSON 字符串或 NULL，
  // 非字符串入参不可达，直接按字符串归一。
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return Array.isArray(parsed) && parsed.length > 0 ? (parsed as SpecialDiscount[]) : null;
  } catch {
    return null;
  }
}

function roundTotal(rawTotal: number, roundingMode: string): number {
  if (roundingMode === 'ROUND') return Math.round(rawTotal / 100) * 100;
  if (roundingMode === 'NONE') return rawTotal;
  return Math.floor(rawTotal / 100) * 100;
}

export class MemberDiscountService {
  constructor(private readonly db: Database.Database) {}

  savePlan(cardId: string, input: SavePlanInput, context: AppContext): Record<string, unknown> {
    const card = this.findCard(cardId, context, false);
    const discountRate = optionalInteger(input.discountRate, 0, 100, '折扣率必须为 0-100 的整数');
    const maxDiscountAmount = optionalInteger(
      input.maxDiscountAmount,
      0,
      Number.MAX_SAFE_INTEGER,
      '单次折扣上限必须为不小于 0 的整数（分）',
    );
    const roundingMode = optionalRoundingMode(input.roundingMode);
    const annualDiscountLimit = optionalInteger(
      input.annualDiscountLimit,
      0,
      Number.MAX_SAFE_INTEGER,
      '年度折扣上限必须为不小于 0 的整数（分）',
    );
    const specialDiscounts = optionalSpecialDiscounts(input.specialDiscountsJson);

    const now = context.now().toISOString();
    this.db.prepare(
      `UPDATE MemberCard
       SET discountRate = ?, maxDiscountAmount = ?, roundingMode = ?, annualDiscountLimit = ?,
           specialDiscountsJson = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(
      discountRate,
      maxDiscountAmount,
      roundingMode,
      annualDiscountLimit,
      specialDiscounts === null ? null : JSON.stringify(specialDiscounts),
      now,
      cardId,
      ...tenantParams(context.clinicId),
    );

    return {
      id: card.id,
      cardNo: card.cardNo,
      discountRate,
      maxDiscountAmount,
      roundingMode,
      annualDiscountLimit,
      specialDiscountsJson: specialDiscounts,
    };
  }

  getPlan(cardId: string, context: AppContext): Record<string, unknown> {
    const card = this.findCard(cardId, context, true);
    return {
      id: card.id,
      cardNo: card.cardNo,
      discountRate: card.discountRate,
      maxDiscountAmount: card.maxDiscountAmount,
      roundingMode: card.roundingMode,
      annualDiscountLimit: card.annualDiscountLimit,
      specialDiscountsJson: parseStoredSpecialDiscounts(card.specialDiscountsJson),
    };
  }

  quote(cardId: string, input: QuoteInput, context: AppContext): Record<string, unknown> {
    const card = this.findCard(cardId, context, true);
    const specials = parseStoredSpecialDiscounts(card.specialDiscountsJson);
    const baseTotal = input?.baseTotal;
    if (typeof baseTotal !== 'number' || !Number.isSafeInteger(baseTotal) || baseTotal < 0) {
      throw new ValidationError('原价金额必须为不小于 0 的整数（分）');
    }
    if (card.discountRate === null && !specials) {
      return {
        cardId: card.id,
        cardNo: card.cardNo,
        applied: false,
        baseTotal,
        discount: 0,
        total: baseTotal,
        reason: 'NO_PLAN',
      };
    }

    const items: QuoteItem[] = [];
    if (input.items !== undefined && input.items !== null) {
      if (!Array.isArray(input.items)) throw new ValidationError('报价项目无效');
      for (const item of input.items) {
        if (typeof item !== 'object' || item === null) throw new ValidationError('报价项目无效');
        const subtotal = (item as QuoteItem).subtotal;
        if (typeof subtotal !== 'number' || !Number.isSafeInteger(subtotal) || subtotal < 0) {
          throw new ValidationError('报价项目小计必须为不小于 0 的整数（分）');
        }
        items.push({ category: (item as QuoteItem).category, subtotal });
      }
    }

    let discount = 0;
    const breakdown: Array<{ category: string; rate: number; subtotal: number; discount: number }> = [];
    if (items.length > 0) {
      for (const item of items) {
        const category = item.category ?? '';
        const special = (specials ?? []).find((entry) => entry.category === category);
        const rate = special?.rate ?? card.discountRate ?? 100;
        const itemDiscount = Math.round((item.subtotal * (100 - rate)) / 100);
        discount += itemDiscount;
        breakdown.push({ category, rate, subtotal: item.subtotal, discount: itemDiscount });
      }
    } else {
      const rate = card.discountRate ?? 100;
      discount = Math.round((baseTotal * (100 - rate)) / 100);
    }

    if (card.maxDiscountAmount !== null && card.maxDiscountAmount !== undefined) {
      discount = Math.min(discount, Number(card.maxDiscountAmount));
    }

    // 年度归属按诊所时区（+8）统计：跨年边界（如 UTC 12-31 16:30 = 本地 01-01 00:30）必须归入诊所本地年。
    const clinicYear = new SystemClock().clinicDate(context.now()).slice(0, 4);
    const usageRow = this.db.prepare(
      `SELECT COALESCE(SUM(discount), 0) AS usage
       FROM Charge
       WHERE patientId = ? AND deletedAt IS NULL AND discount > 0
         AND strftime('%Y', createdAt, ?) = ?${tenantAnd(context.clinicId)}`,
    ).get(card.patientId, `+${CLINIC_TZ_OFFSET_HOURS} hours`, clinicYear, ...tenantParams(context.clinicId)) as { usage: number };
    // 聚合查询恒返回一行（COALESCE 兜底），usageRow 与 usage 都不可能为 nullish。
    const annualUsage = Number(usageRow.usage);
    let annualRemaining: number | null = null;
    if (card.annualDiscountLimit !== null && card.annualDiscountLimit !== undefined) {
      annualRemaining = Math.max(0, Number(card.annualDiscountLimit) - annualUsage);
      discount = Math.min(discount, annualRemaining);
    }

    const roundingMode = card.roundingMode ?? 'FLOOR';
    // 明细维度折扣按 items 小计计算，而 baseTotal 由调用方传入；两者不一致时
    // 折扣可能超过原价，这里兜底保证报价总价与优惠金额都不会为负。
    const rawTotal = Math.max(0, baseTotal - discount);
    // ROUND 取整可能向上越过原价（如 baseTotal=199、折扣为 0 → 200），封顶到原价，
    // 保证 finalDiscount 恒 >= 0（报价口径不允许超收）。
    const total = Math.min(baseTotal, roundTotal(rawTotal, roundingMode));
    const finalDiscount = baseTotal - total;

    return {
      cardId: card.id,
      cardNo: card.cardNo,
      patientId: card.patientId,
      applied: true,
      baseTotal,
      discount: finalDiscount,
      total,
      roundingMode,
      breakdown,
      annualUsage,
      annualRemaining,
    };
  }

  quoteByPatient(patientId: string, input: QuoteInput, context: AppContext): Record<string, unknown> {
    const row = this.db.prepare(
      `SELECT id FROM MemberCard
       WHERE patientId = ? AND status = 'ACTIVE' AND deletedAt IS NULL${tenantAnd(context.clinicId)}
       ORDER BY createdAt LIMIT 1`,
    ).get(patientId, ...tenantParams(context.clinicId)) as { id: string } | undefined;
    const baseTotal = Number(input?.baseTotal ?? 0);
    if (!row) {
      return { cardId: null, applied: false, baseTotal, discount: 0, total: baseTotal, reason: 'NO_ACTIVE_CARD' };
    }
    return this.quote(row.id, input, context);
  }

  private findCard(cardId: string, context: AppContext, withPlan: boolean): MemberCardPlanRow {
    const columns = withPlan
      ? 'id, patientId, cardNo, discountRate, maxDiscountAmount, roundingMode, annualDiscountLimit, specialDiscountsJson'
      : 'id, patientId, cardNo';
    const row = this.db.prepare(
      `SELECT ${columns} FROM MemberCard
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(cardId, ...tenantParams(context.clinicId)) as MemberCardPlanRow | undefined;
    if (!row) throw new NotFoundError('Member card not found');
    return row;
  }
}
