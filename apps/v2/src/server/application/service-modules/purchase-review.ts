import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams, type DbParam } from '../../infrastructure/tenant';
import { trackResourceWrite } from '../../infrastructure/write-tracking';
import type { AppContext } from '../../../domain/contracts';

/**
 * 采购单审核流服务。
 *
 * 审核状态机（reviewStatus，迁移 136 新增列，默认 'PENDING'）：
 *   PENDING（新建）→ SUBMITTED（提交审核）→ APPROVED（通过）/ REJECTED（驳回，带原因）
 *   REJECTED → SUBMITTED（修改后重新提交）
 *
 * 收货门禁由调用方在 PurchaseOrderService.receive 中检查（仅 reviewStatus='APPROVED'
 * 可收货），本服务只负责审核状态流转，不触碰库存/资金。
 *
 * 时间说明：表无 rejectedAt 列，reject 复用 approvedById/approvedAt 记录“操作人/操作时间”
 * （语义为最近一次审核操作，通过或驳回均写入），返回字段统一用 approvedAt。
 */

const PURCHASE_REVIEW_STATUSES = ['PENDING', 'SUBMITTED', 'APPROVED', 'REJECTED'] as const;

interface PurchaseOrderReviewRow {
  id: string;
  reviewStatus: string | null;
}

export class PurchaseReviewService {
  constructor(private readonly db: Database.Database) {}

  /**
   * 列出该租户未删除的采购单，附供应商名与明细条数，含全部审核列。
   * filter.reviewStatus 非空时必须为合法审核状态之一。
   */
  list(
    context: AppContext,
    options?: { reviewStatus?: string; page?: number; pageSize?: number },
  ): { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number; truncated?: boolean } {
    const reviewStatus = options?.reviewStatus?.trim() ?? '';
    if (reviewStatus && !(PURCHASE_REVIEW_STATUSES as readonly string[]).includes(reviewStatus)) {
      throw new ValidationError('reviewStatus 必须为 PENDING/SUBMITTED/APPROVED/REJECTED 之一');
    }
    const rawPage = Number(options?.page);
    const rawPageSize = Number(options?.pageSize);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const pageSize = Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.min(200, Math.floor(rawPageSize)) : 200;
    const offset = (page - 1) * pageSize;
    const baseParams: DbParam[] = [
      ...tenantParams(context.clinicId),
      ...(reviewStatus ? [reviewStatus] : []),
    ];
    const where = `WHERE po.deletedAt IS NULL${tenantAnd(context.clinicId, 'po.clinicId')}${
      reviewStatus ? ' AND po.reviewStatus = ?' : ''
    }`;
    const total = Number((this.db.prepare(
      `SELECT COUNT(*) AS total FROM PurchaseOrder po ${where}`,
    ).get(...baseParams) as { total: number }).total);
    const rows = this.db.prepare(
      `SELECT po.*, s.name AS supplierName,
              (SELECT COUNT(*) FROM PurchaseOrderItem poi
                WHERE poi.orderId = po.id AND poi.deletedAt IS NULL) AS itemsCount
       FROM PurchaseOrder po
       LEFT JOIN Supplier s ON s.id = po.supplierId AND s.deletedAt IS NULL
       ${where}
       ORDER BY po.createdAt DESC
       LIMIT ? OFFSET ?`,
    ).all(...baseParams, pageSize, offset) as Array<Record<string, unknown>>;
    return { items: rows, total, page, pageSize, truncated: total > offset + rows.length };
  }

  /** 提交审核：PENDING → SUBMITTED。 */
  submit(id: string, context: AppContext): Record<string, unknown> {
    const row = this.findOrder(id, context);
    if (row.reviewStatus !== 'PENDING') throw new ConflictError('仅待提交的采购单可提交审核');
    this.updateReview(id, context, { reviewStatus: 'SUBMITTED' });
    return { id, reviewStatus: 'SUBMITTED' };
  }

  /** 通过：SUBMITTED → APPROVED，记录审批人与审批时间。 */
  approve(id: string, context: AppContext): Record<string, unknown> {
    const row = this.findOrder(id, context);
    if (row.reviewStatus !== 'SUBMITTED') throw new ConflictError('仅待审核的采购单可通过');
    const now = context.now().toISOString();
    this.db.prepare(
      `UPDATE PurchaseOrder
       SET reviewStatus = 'APPROVED', approvedById = ?, approvedAt = ?, rejectionReason = NULL, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(context.userId, now, now, id, ...tenantParams(context.clinicId));
    trackResourceWrite(this.db, { tableName: 'PurchaseOrder', recordId: id, operation: 'UPDATE', clinicId: context.clinicId ?? null });
    return { id, reviewStatus: 'APPROVED', approvedById: context.userId, approvedAt: now };
  }

  /** 驳回：SUBMITTED → REJECTED，必填驳回原因（≤500 字）。 */
  reject(id: string, input: { reason: string }, context: AppContext): Record<string, unknown> {
    const row = this.findOrder(id, context);
    if (row.reviewStatus !== 'SUBMITTED') throw new ConflictError('仅待审核的采购单可驳回');
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    if (!reason) throw new ValidationError('驳回原因必填');
    if (reason.length > 500) throw new ValidationError('驳回原因不能超过 500 字');
    const now = context.now().toISOString();
    this.db.prepare(
      `UPDATE PurchaseOrder
       SET reviewStatus = 'REJECTED', rejectionReason = ?, approvedById = ?, approvedAt = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(reason, context.userId, now, now, id, ...tenantParams(context.clinicId));
    trackResourceWrite(this.db, { tableName: 'PurchaseOrder', recordId: id, operation: 'UPDATE', clinicId: context.clinicId ?? null });
    return { id, reviewStatus: 'REJECTED', rejectionReason: reason };
  }

  /** 重新提交：REJECTED → SUBMITTED，清空驳回原因。 */
  reopen(id: string, context: AppContext): Record<string, unknown> {
    const row = this.findOrder(id, context);
    if (row.reviewStatus !== 'REJECTED') throw new ConflictError('仅已驳回的采购单可重新提交');
    this.updateReview(id, context, { reviewStatus: 'SUBMITTED', rejectionReason: null });
    return { id, reviewStatus: 'SUBMITTED' };
  }

  /** 审核汇总：各状态计数 + 待处理金额（PENDING/SUBMITTED 合计）。 */
  stats(context: AppContext): Record<string, unknown> {
    const counts = this.db.prepare(
      `SELECT reviewStatus, COUNT(*) AS count
       FROM PurchaseOrder
       WHERE deletedAt IS NULL${tenantAnd(context.clinicId)}
       GROUP BY reviewStatus`,
    ).all(...tenantParams(context.clinicId)) as Array<{ reviewStatus: string | null; count: number }>;
    const total = counts.reduce((sum, entry) => sum + Number(entry.count), 0);
    const byStatus: Record<string, number> = {};
    for (const entry of counts) {
      byStatus[String(entry.reviewStatus ?? '')] = Number(entry.count);
    }
    const pendingAmountRow = this.db.prepare(
      `SELECT COALESCE(SUM(totalAmount), 0) AS amount
       FROM PurchaseOrder
       WHERE reviewStatus IN ('PENDING', 'SUBMITTED') AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(...tenantParams(context.clinicId)) as { amount: number | null } | undefined;
    const pendingAmount = Number(pendingAmountRow?.amount ?? 0);
    return {
      total,
      pending: byStatus.PENDING ?? 0,
      submitted: byStatus.SUBMITTED ?? 0,
      approved: byStatus.APPROVED ?? 0,
      rejected: byStatus.REJECTED ?? 0,
      pendingAmount,
    };
  }

  private findOrder(id: string, context: AppContext): PurchaseOrderReviewRow {
    const row = this.db.prepare(
      `SELECT id, reviewStatus
       FROM PurchaseOrder
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as PurchaseOrderReviewRow | undefined;
    if (!row) throw new NotFoundError('Purchase order not found');
    return row;
  }

  private updateReview(
    id: string,
    context: AppContext,
    patch: { reviewStatus: string; rejectionReason?: string | null },
  ): void {
    const now = context.now().toISOString();
    const sets = ['reviewStatus = ?'];
    const params: DbParam[] = [patch.reviewStatus];
    if ('rejectionReason' in patch) {
      sets.push('rejectionReason = ?');
      params.push(patch.rejectionReason ?? null);
    }
    sets.push('updatedAt = ?');
    params.push(now, id, ...tenantParams(context.clinicId));
    this.db.prepare(
      `UPDATE PurchaseOrder SET ${sets.join(', ')}
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(...params);
    trackResourceWrite(this.db, { tableName: 'PurchaseOrder', recordId: id, operation: 'UPDATE', clinicId: context.clinicId ?? null });
  }
}
