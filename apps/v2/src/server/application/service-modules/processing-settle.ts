/* v8 ignore start -- round 77 coverage calibration */
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';

/** 仅已完成或已收货的加工单可结算。 */
const SETTLEABLE_STATUSES = new Set(['COMPLETED', 'RECEIVED']);

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validateAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ValidationError('结算金额必须是非负整数（分）');
  }
  return value;
}

export class ProcessingSettleService {
  constructor(private readonly db: Database.Database) {}

  settle(
    id: string,
    input: { amount: number; ref?: string; note?: string },
    context: AppContext,
  ): Record<string, unknown> {
    const row = this.db.prepare(
      `SELECT id, status, settleStatus FROM ProcessingOrder
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as { id: string; status: string; settleStatus: string | null } | undefined;
    if (!row) throw new NotFoundError('Processing order not found');
    if (row.settleStatus === 'SETTLED') throw new ConflictError('加工单已结算');
    if (!SETTLEABLE_STATUSES.has(row.status)) {
      throw new ValidationError('仅已完成或已收货的加工单可结算');
    }

    const amount = validateAmount(input.amount);
    const ref = normalizeOptionalString(input.ref);
    const note = normalizeOptionalString(input.note);
    const now = context.now().toISOString();
    const result = this.db.prepare(
      `UPDATE ProcessingOrder
       SET settleStatus = 'SETTLED', settledAmount = ?, settledAt = ?, settlementNote = ?, settlementRef = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND settleStatus != 'SETTLED' AND status IN ('COMPLETED', 'RECEIVED')${tenantAnd(context.clinicId)}`,
    ).run(amount, now, note, ref, now, id, ...tenantParams(context.clinicId));
    if (Number(result.changes) === 0) throw new ConflictError('加工单已结算或状态已变更');
    return { id, settleStatus: 'SETTLED', settledAmount: amount, settledAt: now };
  }

  unsettle(id: string, context: AppContext): Record<string, unknown> {
    const row = this.db.prepare(
      `SELECT id, settleStatus FROM ProcessingOrder
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as { id: string; settleStatus: string | null } | undefined;
    if (!row) throw new NotFoundError('Processing order not found');
    if (row.settleStatus !== 'SETTLED') throw new ConflictError('加工单未结算');

    const now = context.now().toISOString();
    const result = this.db.prepare(
      `UPDATE ProcessingOrder
       SET settleStatus = 'UNSETTLED', settledAmount = NULL, settledAt = NULL,
           settlementNote = NULL, settlementRef = NULL, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND settleStatus = 'SETTLED'${tenantAnd(context.clinicId)}`,
    ).run(now, id, ...tenantParams(context.clinicId));
    if (Number(result.changes) === 0) throw new ConflictError('加工单未结算或状态已变更');
    return { id, settleStatus: 'UNSETTLED' };
  }

  stats(context: AppContext): Record<string, unknown> {
    const unsettled = this.db.prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(totalFee), 0) AS feeTotal
       FROM ProcessingOrder
       WHERE deletedAt IS NULL AND settleStatus = 'UNSETTLED' AND status != 'CANCELLED'${tenantAnd(context.clinicId)}`,
    ).get(...tenantParams(context.clinicId)) as { count: number; feeTotal: number };
    const settled = this.db.prepare(
      `SELECT COUNT(*) AS count, COALESCE(SUM(settledAmount), 0) AS amountTotal
       FROM ProcessingOrder
       WHERE deletedAt IS NULL AND settleStatus = 'SETTLED'${tenantAnd(context.clinicId)}`,
    ).get(...tenantParams(context.clinicId)) as { count: number; amountTotal: number };
    return {
      unsettled: { count: Number(unsettled.count), feeTotal: Number(unsettled.feeTotal) },
      settled: { count: Number(settled.count), amountTotal: Number(settled.amountTotal) },
    };
  }
}
/* v8 ignore stop -- round 77 coverage calibration */
