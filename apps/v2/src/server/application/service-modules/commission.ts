import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';

const PERIOD_RE = /^\d{4}-\d{2}$/;

export interface CommissionRuleRow {
  id: string;
  name: string;
  category: string | null;
  costType: 'SERVICE' | 'MATERIAL' | null;
  rateType: 'PERCENT' | 'FIXED';
  rate: number;
  doctorId: string | null;
  enabled: number;
  clinicId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CommissionRuleInput {
  name: string;
  category?: string | null;
  costType?: 'SERVICE' | 'MATERIAL' | null;
  rateType: 'PERCENT' | 'FIXED';
  rate: number;
  doctorId?: string | null;
  enabled?: boolean;
}

export interface CommissionStatementRow {
  id: string;
  period: string;
  doctorId: string;
  doctorName: string | null;
  totalCharged: number;
  totalCommission: number;
  breakdown: Array<{
    category: string;
    costType: string;
    charged: number;
    commission: number;
  }>;
  calculatedAt: string;
}

interface CommissionLine {
  doctorId: string;
  chargeId: string;
  category: string;
  costType: string;
  paidBase: number;
}

interface DoctorRuleSet {
  specific: CommissionRuleRow[];
  defaultRules: CommissionRuleRow[];
}

interface ChargeRow {
  id: string;
  doctorId: string | null;
  paidAmount: number;
  refundedAmount: number;
  totalAmount: number;
}

interface ItemRow {
  chargeId: string;
  category: string;
  costType: string;
  subtotal: number;
}

interface StatementRow {
  id: string;
  period: string;
  doctorId: string;
  totalCharged: number;
  totalCommission: number;
  breakdownJson: string;
  calculatedAt: string;
  doctorName: string | null;
}

export class CommissionService {
  constructor(private readonly db: Database.Database) {}

  listRules(context: AppContext): CommissionRuleRow[] {
    return this.db.prepare(
      `SELECT * FROM CommissionRule WHERE deletedAt IS NULL${tenantAnd(context.clinicId)}
       ORDER BY CASE WHEN doctorId IS NULL THEN 1 ELSE 0 END, category IS NOT NULL DESC, createdAt ASC`,
    ).all(...tenantParams(context.clinicId)).map((row) => toRuleRow(row as Record<string, unknown>));
  }

  createRule(input: CommissionRuleInput, context: AppContext): CommissionRuleRow {
    const rule = normalizeRule(input);
    const now = context.now().toISOString();
    const id = randomUUID();
    this.db.prepare(
      `INSERT INTO CommissionRule (
         id, clinicId, name, category, costType, rateType, rate, doctorId, enabled,
         createdAt, updatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    ).run(
      id, context.clinicId ?? null, rule.name, rule.category, rule.costType,
      rule.rateType, rule.rate, rule.doctorId, rule.enabled ? 1 : 0, now, now,
    );
    return this.getRule(id, context)!;
  }

  updateRule(id: string, patch: Partial<CommissionRuleInput>, context: AppContext): CommissionRuleRow {
    const existing = this.getRule(id, context);
    if (!existing) throw new NotFoundError('Commission rule not found');
    const merged = normalizeRule({
      name: patch.name === undefined ? existing.name : patch.name,
      category: patch.category === undefined ? existing.category : patch.category,
      costType: patch.costType === undefined ? existing.costType : patch.costType,
      rateType: patch.rateType ?? existing.rateType,
      rate: patch.rate === undefined ? existing.rate : patch.rate,
      doctorId: patch.doctorId === undefined ? existing.doctorId : patch.doctorId,
      enabled: patch.enabled === undefined ? Number(existing.enabled) === 1 : patch.enabled,
    });
    const now = context.now().toISOString();
    const result = this.db.prepare(
      `UPDATE CommissionRule
       SET name = ?, category = ?, costType = ?, rateType = ?, rate = ?, doctorId = ?, enabled = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(
      merged.name, merged.category, merged.costType, merged.rateType, merged.rate,
      merged.doctorId, merged.enabled ? 1 : 0, now, id, ...tenantParams(context.clinicId),
    );
    if (Number(result.changes) === 0) throw new NotFoundError('Commission rule not found');
    return this.getRule(id, context)!;
  }

  deleteRule(id: string, context: AppContext): void {
    const existing = this.getRule(id, context);
    if (!existing) throw new NotFoundError('Commission rule not found');
    const now = context.now().toISOString();
    const result = this.db.prepare(
      `UPDATE CommissionRule SET deletedAt = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(now, now, id, ...tenantParams(context.clinicId));
    if (Number(result.changes) === 0) throw new NotFoundError('Commission rule not found');
  }

  calculate(period: string, context: AppContext): CommissionStatementRow[] {
    const normalizedPeriod = normalizePeriod(period);
    const start = `${normalizedPeriod}-01`;
    const endExclusive = nextMonth(normalizedPeriod);
    const charges = this.db.prepare(
      `SELECT id, doctorId, totalAmount, paidAmount, refundedAmount FROM Charge
       WHERE paidAt >= ? AND paidAt < ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).all(start, endExclusive, ...tenantParams(context.clinicId)) as ChargeRow[];
    const chargeIds = charges.map((charge) => charge.id);

    const items = chargeIds.length > 0
      ? (this.db.prepare(
          `SELECT chargeId, category, COALESCE(costType, 'SERVICE') AS costType, subtotal
           FROM ChargeItem WHERE chargeId IN (${chargeIds.map(() => '?').join(',')}) AND deletedAt IS NULL`,
        ).all(...chargeIds) as ItemRow[])
      : [];

    const rules = this.listRules(context);
    const lines = buildLines(charges, items);
    const grouped = new Map<string, { charged: number; commission: number; rows: CommissionLine[] }>();
    for (const line of lines) {
      const current = grouped.get(line.doctorId) ?? { charged: 0, commission: 0, rows: [] };
      current.charged += line.paidBase;
      current.rows.push(line);
      grouped.set(line.doctorId, current);
    }

    const now = context.now().toISOString();
    const upsert = this.db.prepare(
      `INSERT INTO CommissionStatement (
         id, clinicId, period, doctorId, totalCharged, totalCommission, breakdownJson, calculatedAt, deletedAt
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT (clinicId, period, doctorId) DO UPDATE SET
         totalCharged = excluded.totalCharged,
         totalCommission = excluded.totalCommission,
         breakdownJson = excluded.breakdownJson,
         calculatedAt = excluded.calculatedAt`,
    );
    const run = this.db.transaction(() => {
      // 本期无任何计费（例如全部退款）时，历史生成的提成单必须清空，
      // 否则报表继续展示早已失效的金额。
      if (grouped.size === 0) {
        this.db.prepare(
          `DELETE FROM CommissionStatement WHERE period = ?${tenantAnd(context.clinicId)}`,
        ).run(normalizedPeriod, ...tenantParams(context.clinicId));
        return;
      }
      for (const [doctorId, bucket] of grouped) {
        const ruleSet = ruleSetForDoctor(rules, doctorId);
        const { total: commission, breakdown } = computeCommission(bucket.rows, ruleSet);
        const id = randomUUID();
        upsert.run(
          id, context.clinicId ?? null, normalizedPeriod, doctorId,
          bucket.charged, commission, JSON.stringify(breakdown), now,
        );
      }
      // 医生被移除/规则变化后不再出现在本期结果时，旧提成单必须一并删除。
      const presentDoctorIds = Array.from(grouped.keys());
      const doctorPlaceholders = presentDoctorIds.map(() => '?').join(',');
      this.db.prepare(
        `DELETE FROM CommissionStatement
         WHERE period = ? AND deletedAt IS NULL AND doctorId NOT IN (${doctorPlaceholders})${tenantAnd(context.clinicId)}`,
      ).run(normalizedPeriod, ...presentDoctorIds, ...tenantParams(context.clinicId));
    });
    run();
    return this.statements(normalizedPeriod, context, { doctorId: null });
  }

  statements(
    period: string,
    context: AppContext,
    opts: { doctorId?: string | null } = {},
  ): CommissionStatementRow[] {
    const normalizedPeriod = normalizePeriod(period);
    const conditions = ['S.deletedAt IS NULL', 'S.period = ?'];
    const params: unknown[] = [normalizedPeriod];
    const requestedDoctorId = context.role === 'DOCTOR' ? context.userId : (opts.doctorId ?? null);
    if (requestedDoctorId !== null) {
      conditions.push('S.doctorId = ?');
      params.push(requestedDoctorId);
    }
    const rows = this.db.prepare(
      `SELECT S.*, COALESCE(U.name, U.username, S.doctorId) AS doctorName
       FROM CommissionStatement S
       LEFT JOIN User U ON U.id = S.doctorId AND U.deletedAt IS NULL
       WHERE ${conditions.join(' AND ')}${tenantAnd(context.clinicId, 'S.clinicId')}
       ORDER BY S.totalCommission DESC, S.doctorId ASC`,
    ).all(...params, ...tenantParams(context.clinicId)) as StatementRow[];
    return rows.map(toStatementRow);
  }

  private getRule(id: string, context: AppContext): CommissionRuleRow | undefined {
    const row = this.db.prepare(
      `SELECT * FROM CommissionRule WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as Record<string, unknown> | undefined;
    return row ? toRuleRow(row) : undefined;
  }
}

function normalizeRule(input: CommissionRuleInput): CommissionRuleRow {
  const name = typeof input.name === 'string' ? input.name.trim() : '';
  if (!name) throw new ValidationError('规则名称不能为空');
  if (input.rateType !== 'PERCENT' && input.rateType !== 'FIXED') {
    throw new ValidationError('rateType 必须是 PERCENT 或 FIXED');
  }
  const rate = Number(input.rate);
  if (!Number.isSafeInteger(rate) || rate < 0) {
    throw new ValidationError('提成比例/金额必须是非负整数');
  }
  if (input.rateType === 'PERCENT' && rate > 10_000) {
    throw new ValidationError('提成比例不能超过 100%');
  }
  if (input.rateType === 'FIXED' && rate > 1_000_000_000_000) {
    throw new ValidationError('固定提成金额超过上限');
  }
  const category = input.category === undefined || input.category === null || String(input.category).trim() === ''
    ? null
    : String(input.category).trim();
  const costType = input.costType === undefined || input.costType === null ? null : input.costType;
  if (costType !== null && costType !== 'SERVICE' && costType !== 'MATERIAL') {
    throw new ValidationError('costType 必须是 SERVICE、MATERIAL 或留空');
  }
  const doctorId = input.doctorId === undefined || input.doctorId === null || input.doctorId === ''
    ? null
    : String(input.doctorId);
  return {
    id: '',
    name,
    category,
    costType,
    rateType: input.rateType,
    rate,
    doctorId,
    enabled: input.enabled === false ? 0 : 1,
    clinicId: null,
    createdAt: '',
    updatedAt: '',
  };
}

function toRuleRow(row: Record<string, unknown>): CommissionRuleRow {
  return {
    id: String(row.id),
    name: String(row.name ?? ''),
    category: row.category === null || row.category === undefined ? null : String(row.category),
    costType: row.costType === null || row.costType === undefined ? null : row.costType as 'SERVICE' | 'MATERIAL',
    rateType: String(row.rateType) as 'PERCENT' | 'FIXED',
    rate: Number(row.rate ?? 0),
    doctorId: row.doctorId === null || row.doctorId === undefined ? null : String(row.doctorId),
    enabled: Number(row.enabled ?? 1),
    clinicId: row.clinicId === null || row.clinicId === undefined ? null : String(row.clinicId),
    createdAt: String(row.createdAt ?? ''),
    updatedAt: String(row.updatedAt ?? ''),
  };
}

function toStatementRow(row: StatementRow): CommissionStatementRow {
  let breakdown: CommissionStatementRow['breakdown'] = [];
  try {
    const parsed = JSON.parse(row.breakdownJson);
    if (Array.isArray(parsed)) breakdown = parsed as CommissionStatementRow['breakdown'];
  } catch {
    breakdown = [];
  }
  return {
    id: row.id,
    period: row.period,
    doctorId: row.doctorId,
    doctorName: row.doctorName === null || row.doctorName === undefined ? null : String(row.doctorName),
    totalCharged: Number(row.totalCharged ?? 0),
    totalCommission: Number(row.totalCommission ?? 0),
    breakdown,
    calculatedAt: row.calculatedAt,
  };
}

function normalizePeriod(value: string): string {
  const period = typeof value === 'string' ? value.trim() : '';
  if (!PERIOD_RE.test(period)) throw new ValidationError('period 格式应为 YYYY-MM');
  const [, monthText] = period.split('-');
  const month = Number(monthText);
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new ValidationError('period 月份必须在 01-12 之间');
  }
  return period;
}

function nextMonth(period: string): string {
  const [yearText, monthText] = period.split('-');
  const year = Number(yearText);
  const month = Number(monthText);
  const next = new Date(year, month, 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
}

function buildLines(charges: ChargeRow[], items: ItemRow[]): CommissionLine[] {
  const byCharge = new Map<string, ItemRow[]>();
  for (const item of items) {
    const list = byCharge.get(item.chargeId) ?? [];
    list.push(item);
    byCharge.set(item.chargeId, list);
  }
  const lines: CommissionLine[] = [];
  for (const charge of charges) {
    const doctorId = charge.doctorId;
    if (!doctorId) continue;
    const chargeItems = byCharge.get(charge.id) ?? [];
    if (chargeItems.length === 0) continue;
    const effectivePaid = Math.max(0, Number(charge.paidAmount ?? 0) - Number(charge.refundedAmount ?? 0));
    if (effectivePaid <= 0) continue;
    const totalSubtotal = chargeItems.reduce((sum, item) => sum + Math.max(0, Number(item.subtotal ?? 0)), 0);
    const chargeLines: CommissionLine[] = [];
    for (const item of chargeItems) {
      const paidBase = totalSubtotal > 0
        ? Math.round((effectivePaid * Math.max(0, Number(item.subtotal ?? 0))) / totalSubtotal)
        : Math.floor(effectivePaid / chargeItems.length);
      if (paidBase <= 0) continue;
      chargeLines.push({
        doctorId,
        chargeId: charge.id,
        category: String(item.category ?? ''),
        costType: String(item.costType ?? 'SERVICE'),
        paidBase,
      });
    }
    // 独立四舍五入可能让各明细分摊之和超过 effectivePaid（例如 101 分两行
    // 各 50 分得到 51+51=102），从末行回退溢出，保证总额不越界。
    const allocated = chargeLines.reduce((sum, line) => sum + line.paidBase, 0);
    if (allocated > effectivePaid) {
      let overshoot = allocated - effectivePaid;
      for (let i = chargeLines.length - 1; i >= 0 && overshoot > 0; i -= 1) {
        const reduce = Math.min(chargeLines[i].paidBase, overshoot);
        chargeLines[i].paidBase -= reduce;
        overshoot -= reduce;
      }
    }
    for (const line of chargeLines) {
      if (line.paidBase > 0) lines.push(line);
    }
  }
  return lines;
}

function ruleSetForDoctor(rules: CommissionRuleRow[], doctorId: string): DoctorRuleSet {
  const specific = rules.filter((rule) => rule.enabled === 1 && rule.doctorId === doctorId);
  const defaultRules = rules.filter((rule) => rule.enabled === 1 && rule.doctorId === null);
  return { specific, defaultRules };
}

function matchRule(set: DoctorRuleSet, line: CommissionLine): CommissionRuleRow | null {
  const candidates = [...set.specific, ...set.defaultRules];
  return candidates.find((rule) => rule.category === line.category && rule.costType === line.costType)
    ?? candidates.find((rule) => rule.category === line.category && rule.costType === null)
    ?? candidates.find((rule) => rule.category === null && rule.costType === line.costType)
    ?? candidates.find((rule) => rule.category === null && rule.costType === null)
    ?? null;
}

function computeCommission(
  lines: CommissionLine[],
  ruleSet: DoctorRuleSet,
): { total: number; breakdown: CommissionStatementRow['breakdown'] } {
  const seenFixedCharges = new Set<string>();
  let total = 0;
  const map = new Map<string, { category: string; costType: string; charged: number; commission: number }>();
  for (const line of lines) {
    const rule = matchRule(ruleSet, line);
    if (!rule) continue;
    let commission = 0;
    if (rule.rateType === 'FIXED') {
      if (seenFixedCharges.has(line.chargeId)) continue;
      seenFixedCharges.add(line.chargeId);
      commission = rule.rate;
    } else {
      commission = Math.round((line.paidBase * rule.rate) / 10_000);
    }
    total += commission;
    if (total > 1_000_000_000_000) throw new ValidationError('提成总额超过上限');
    const key = `${line.category}\u0000${line.costType}`;
    const current = map.get(key) ?? { category: line.category, costType: line.costType, charged: 0, commission: 0 };
    current.charged += line.paidBase;
    current.commission += commission;
    map.set(key, current);
  }
  return { total, breakdown: Array.from(map.values()) };
}
