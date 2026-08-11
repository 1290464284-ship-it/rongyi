import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { trackResourceWrite } from '../../infrastructure/write-tracking';
import type { AppContext } from '../../../domain/contracts';

/**
 * 退费待退费中间态（审批流状态机）。
 *
 * ChargeService.refund 创建 Refund 行（status 列默认 'REQUESTED'）并立即完成资金扣减
 * （Charge.refundedAmount 增加、会员卡余额回充、Debt.paidAmount 回退）。
 * 本服务负责：
 *   - 状态机：REQUESTED → PENDING_REFUND（审批通过）→ COMPLETED（确认退款）
 *   - 驳回/取消：状态置为 REJECTED / CANCELLED，并对已发生的资金变动做反向冲销（reversal）。
 */
interface RefundRow {
  id: string;
  chargeId: string;
  amount: number;
  status: string;
}

export class RefundFlowService {
  constructor(private readonly db: Database.Database) {}

  list(context: AppContext, options?: { page?: number; pageSize?: number }): Array<Record<string, unknown>> {
    const pageRaw = Number(options?.page ?? 1);
    const pageSizeRaw = Number(options?.pageSize ?? 200);
    if (!Number.isFinite(pageRaw) || pageRaw < 1 || !Number.isInteger(pageRaw)) {
      throw new ValidationError('分页参数无效');
    }
    if (!Number.isFinite(pageSizeRaw) || pageSizeRaw < 1 || !Number.isInteger(pageSizeRaw)) {
      throw new ValidationError('分页大小无效');
    }
    const page = Math.max(1, pageRaw);
    const pageSize = Math.min(200, Math.max(1, pageSizeRaw));
    const offset = (page - 1) * pageSize;
    // Refund 与 Charge/Patient 均有 clinicId，tenantAnd 需显式使用 Refund 列前缀。
    const rows = this.db.prepare(
      `SELECT r.id, r.amount, r.reason, r.status, r.createdAt, r.approvedAt, r.processedAt,
              r.operatorId, r.approvedById, r.processedById,
              p.id AS patientId, p.name AS patientName,
              c.id AS chargeId, c.number AS chargeNumber, c.totalAmount, c.paidAmount, c.refundedAmount
       FROM Refund r
       LEFT JOIN Patient p ON p.id = r.patientId
       LEFT JOIN Charge c ON c.id = r.chargeId
       WHERE r.deletedAt IS NULL${tenantAnd(context.clinicId, 'r.clinicId')}
       ORDER BY r.createdAt DESC
       LIMIT ? OFFSET ?`,
    ).all(...tenantParams(context.clinicId), pageSize, offset);
    return rows as Array<Record<string, unknown>>;
  }

  count(context: AppContext): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total
       FROM Refund r
       WHERE r.deletedAt IS NULL${tenantAnd(context.clinicId, 'r.clinicId')}`,
    ).get(...tenantParams(context.clinicId)) as { total: number };
    return Number(row.total);
  }

  approve(id: string, context: AppContext): Record<string, unknown> {
    const row = this.findRefund(id, context);
    if (row.status !== 'REQUESTED') throw new ConflictError('仅待审核的退款可审批通过');
    const now = context.now().toISOString();
    const result = this.db.prepare(
      `UPDATE Refund
       SET status = 'PENDING_REFUND', approvedById = ?, approvedAt = ?, updatedAt = ?
       WHERE id = ? AND status = 'REQUESTED' AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(context.userId, now, now, id, ...tenantParams(context.clinicId));
    if (result.changes === 0) throw new ConflictError('仅待审核的退款可审批通过');
    return { id, status: 'PENDING_REFUND', approvedAt: now };
  }

  reject(id: string, context: AppContext): Record<string, unknown> {
    const row = this.findRefund(id, context);
    if (row.status !== 'REQUESTED') throw new ConflictError('仅待审核的退款可驳回');
    const now = context.now().toISOString();
    const run = this.db.transaction(() => {
      const result = this.db.prepare(
        `UPDATE Refund
         SET status = 'REJECTED', approvedById = ?, approvedAt = ?, updatedAt = ?
         WHERE id = ? AND status = 'REQUESTED' AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).run(context.userId, now, now, id, ...tenantParams(context.clinicId));
      if (result.changes === 0) throw new ConflictError('仅待审核的退款可驳回');
      this.reversal(row, context, now);
    });
    run();
    return { id, status: 'REJECTED' };
  }

  cancel(id: string, context: AppContext): Record<string, unknown> {
    const row = this.findRefund(id, context);
    if (row.status !== 'REQUESTED') throw new ConflictError('仅待审核的退款可取消');
    const now = context.now().toISOString();
    const run = this.db.transaction(() => {
      const result = this.db.prepare(
        `UPDATE Refund
         SET status = 'CANCELLED', updatedAt = ?
         WHERE id = ? AND status = 'REQUESTED' AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).run(now, id, ...tenantParams(context.clinicId));
      if (result.changes === 0) throw new ConflictError('仅待审核的退款可取消');
      this.reversal(row, context, now);
    });
    run();
    return { id, status: 'CANCELLED' };
  }

  process(id: string, context: AppContext): Record<string, unknown> {
    const row = this.findRefund(id, context);
    if (row.status !== 'PENDING_REFUND') throw new ConflictError('仅待退款的记录可确认完成');
    const now = context.now().toISOString();
    const result = this.db.prepare(
      `UPDATE Refund
       SET status = 'COMPLETED', processedById = ?, processedAt = ?, updatedAt = ?
       WHERE id = ? AND status = 'PENDING_REFUND' AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(context.userId, now, now, id, ...tenantParams(context.clinicId));
    if (result.changes === 0) throw new ConflictError('仅待退款的记录可确认完成');
    return { id, status: 'COMPLETED', processedAt: now };
  }

  private findRefund(id: string, context: AppContext): RefundRow {
    const row = this.db.prepare(
      `SELECT id, chargeId, amount, status
       FROM Refund
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as RefundRow | undefined;
    if (!row) throw new NotFoundError('Refund not found');
    return row;
  }

  /**
   * 驳回/取消共用资金回滚（反向冲销），须在事务内调用。
   * ChargeService.refund 已立即扣减 Charge.refundedAmount、回充会员卡余额、回退 Debt.paidAmount；
   * 此处将上述变动逐一冲销，恢复到退款申请前的状态。
   */
  private reversal(refundRow: RefundRow, context: AppContext, now: string): void {
    const charge = this.db.prepare(
      `SELECT * FROM Charge WHERE id = ? AND deletedAt IS NULL`,
    ).get(refundRow.chargeId) as Record<string, unknown> | undefined;
    if (!charge) return; // 收费单已删则跳过

    const amount = Number(refundRow.amount);
    const chargeUpdate = this.db.prepare(
      `UPDATE Charge
       SET refundedAmount = refundedAmount - ?,
           status = CASE
             WHEN refundedAmount - ? >= paidAmount THEN 'REFUNDED'
             WHEN paidAmount >= totalAmount THEN 'PAID'
             WHEN paidAmount > 0 THEN 'PARTIAL'
             ELSE 'UNPAID'
           END,
           updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND refundedAmount >= ?`,
    ).run(amount, amount, now, charge.id, amount);
    if (chargeUpdate.changes === 0) {
      throw new ConflictError('退款冲销金额已变化，请刷新后重试');
    }
    // Charge 状态变更统一维护同步与搜索索引。
    trackResourceWrite(this.db, {
      tableName: 'Charge',
      recordId: String(charge.id),
      operation: 'UPDATE',
      clinicId: charge.clinicId ? String(charge.clinicId) : null,
    });

    // 新退款（迁移 146 后）在 PaymentLedger 留有 REFUND 行与逐笔 allocations：
    // 按流水精确回退对应卡余额并回退 reversedAmount。旧退款（无 allocations）
    // 走原 payMethod 整单冲销兜底。
    const refundLedger = this.db.prepare(
      `SELECT allocations FROM PaymentLedger WHERE relatedId = ? AND type = 'REFUND' AND deletedAt IS NULL`,
    ).get(refundRow.id) as { allocations: string | null } | undefined;
    let allocations: Array<{ ledgerId: string; cardId: string; amount: number }> = [];
    if (refundLedger?.allocations) {
      try {
        const parsed = JSON.parse(refundLedger.allocations) as unknown;
        allocations = Array.isArray(parsed) ? parsed as Array<{ ledgerId: string; cardId: string; amount: number }> : [];
      } catch {
        throw new ConflictError('退款冲销分配数据损坏，请恢复 PaymentLedger 后重试');
      }
    }
    if (allocations.length > 0) {
      for (const allocation of allocations) {
        const card = this.db.prepare(
          `SELECT id, balance
           FROM MemberCard
           WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
        ).get(allocation.cardId, ...tenantParams(context.clinicId)) as { id: string; balance: number } | undefined;
        if (!card) {
          throw new ConflictError(`退款冲销原卡 ${allocation.cardId} 不可用，请恢复会员卡后重试`);
        }
        const balanceUpdate = this.db.prepare(
          `UPDATE MemberCard SET balance = balance - ?, updatedAt = ?
           WHERE id = ? AND deletedAt IS NULL AND balance >= ?`,
        ).run(allocation.amount, now, card.id, allocation.amount);
        if (balanceUpdate.changes === 0) {
          throw new ConflictError('退款冲销会员卡余额不足，请先充值后再驳回/取消');
        }
        const currentBalance = Number(card.balance);
        const newBalance = currentBalance - allocation.amount;
        this.db.prepare(
          `INSERT INTO MemberCardLog (
             id, clinicId, createdAt, updatedAt, deletedAt,
             cardId, type, amount, balanceAfter, remark
           ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
        ).run(
          randomUUID(),
          charge.clinicId ?? null,
          now,
          now,
          card.id,
          'REFUND_REVERSAL',
          -allocation.amount,
          newBalance,
          '退款驳回/取消回滚',
        );
        this.db.prepare(
          `UPDATE PaymentLedger SET reversedAmount = MAX(0, reversedAmount - ?), updatedAt = ? WHERE id = ?`,
        ).run(allocation.amount, now, allocation.ledgerId);
      }
    } else if (charge.payMethod === 'MEMBER_CARD') {
      // 优先按原支付卡冲销（ChargeService.pay 已把 memberCardId 落库），
      // 与 ChargeService.refund 回充的卡保持一致，多卡场景不再误扣"第一张 ACTIVE 卡"。
      const card = charge.memberCardId
        ? (this.db.prepare(
            `SELECT id, balance
             FROM MemberCard
             WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
          ).get(String(charge.memberCardId), ...tenantParams(context.clinicId)) as { id: string; balance: number } | undefined)
        : undefined;
      if (!card) throw new ConflictError('退款冲销原支付卡不可用，请恢复会员卡后重试');
      const balanceUpdate = this.db.prepare(
        `UPDATE MemberCard SET balance = balance - ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL AND balance >= ?`,
      ).run(amount, now, card.id, amount);
      if (balanceUpdate.changes === 0) {
        throw new ConflictError('退款冲销会员卡余额不足，请先充值后再驳回/取消');
      }
      const currentBalance = Number(card.balance);
      const newBalance = currentBalance - amount;
      // 列与 SqliteMemberCardRepository.insertLog 保持一致
      this.db.prepare(
        `INSERT INTO MemberCardLog (
           id, clinicId, createdAt, updatedAt, deletedAt,
           cardId, type, amount, balanceAfter, remark
         ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
      ).run(
        randomUUID(),
        charge.clinicId ?? null,
        now,
        now,
        card.id,
        'REFUND_REVERSAL',
        -amount,
        newBalance,
        '退款驳回/取消回滚',
      );
      this.db.prepare(
        `UPDATE PaymentLedger SET reversedAmount = MAX(0, reversedAmount - ?), updatedAt = ?
         WHERE chargeId = ? AND cardId = ? AND type = 'PAY' AND deletedAt IS NULL`,
      ).run(amount, now, refundRow.chargeId, card.id);
    }

    const debt = this.db.prepare(
      `SELECT * FROM Debt WHERE chargeId = ? AND deletedAt IS NULL`,
    ).get(refundRow.chargeId) as Record<string, unknown> | undefined;
    if (debt && Number(debt.paidAmount ?? 0) > 0) {
      // 退款申请时 Debt.paidAmount 已被扣减 amount，驳回/取消需恢复原状（封顶 totalAmount）。
      const debtUpdate = this.db.prepare(
        `UPDATE Debt
         SET paidAmount = paidAmount + ?,
             status = CASE
               WHEN paidAmount + ? >= totalAmount THEN 'PAID'
               WHEN paidAmount + ? > 0 THEN 'PARTIAL'
               ELSE 'UNPAID'
             END,
             updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL AND paidAmount + ? <= totalAmount`,
      ).run(amount, amount, amount, now, debt.id, amount);
      if (debtUpdate.changes === 0) {
        throw new ConflictError('退款冲销欠款状态已变化，请刷新后重试');
      }
    }
  }
}
