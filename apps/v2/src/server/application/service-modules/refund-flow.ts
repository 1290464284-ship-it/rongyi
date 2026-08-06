import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
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
    const page = Math.max(1, Number(options?.page ?? 1));
    const pageSize = Math.min(200, Math.max(1, Number(options?.pageSize ?? 200)));
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
    this.db.prepare(
      `UPDATE Refund
       SET status = 'PENDING_REFUND', approvedById = ?, approvedAt = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(context.userId, now, now, id, ...tenantParams(context.clinicId));
    return { id, status: 'PENDING_REFUND', approvedAt: now };
  }

  reject(id: string, context: AppContext): Record<string, unknown> {
    const row = this.findRefund(id, context);
    if (row.status !== 'REQUESTED') throw new ConflictError('仅待审核的退款可驳回');
    const now = context.now().toISOString();
    const run = this.db.transaction(() => {
      this.db.prepare(
        `UPDATE Refund
         SET status = 'REJECTED', approvedById = ?, approvedAt = ?, updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).run(context.userId, now, now, id, ...tenantParams(context.clinicId));
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
      this.db.prepare(
        `UPDATE Refund
         SET status = 'CANCELLED', updatedAt = ?
         WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
      ).run(now, id, ...tenantParams(context.clinicId));
      this.reversal(row, context, now);
    });
    run();
    return { id, status: 'CANCELLED' };
  }

  process(id: string, context: AppContext): Record<string, unknown> {
    const row = this.findRefund(id, context);
    if (row.status !== 'PENDING_REFUND') throw new ConflictError('仅待退款的记录可确认完成');
    const now = context.now().toISOString();
    this.db.prepare(
      `UPDATE Refund
       SET status = 'COMPLETED', processedById = ?, processedAt = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).run(context.userId, now, now, id, ...tenantParams(context.clinicId));
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
    const refunded = Number(charge.refundedAmount ?? 0);
    const paid = Number(charge.paidAmount ?? 0);
    const total = Number(charge.totalAmount ?? 0);
    const newRefunded = Math.max(0, refunded - amount);
    const chargeStatus = newRefunded >= paid
      ? 'REFUNDED'
      : paid >= total ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID';
    this.db.prepare(
      `UPDATE Charge SET refundedAmount = ?, status = ?, updatedAt = ? WHERE id = ?`,
    ).run(newRefunded, chargeStatus, now, charge.id);

    if (charge.payMethod === 'MEMBER_CARD') {
      // 优先按原支付卡冲销（ChargeService.pay 已把 memberCardId 落库），
      // 与 ChargeService.refund 回充的卡保持一致，多卡场景不再误扣"第一张 ACTIVE 卡"。
      let card = charge.memberCardId
        ? (this.db.prepare(
            `SELECT id, balance
             FROM MemberCard
             WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
          ).get(String(charge.memberCardId), ...tenantParams(context.clinicId)) as { id: string; balance: number } | undefined)
        : undefined;
      if (!card) {
        // 原卡缺失/不可用（如已删）：回退按患者取卡（与 findByPatientForRefund 口径一致），并告警以便排查。
        card = this.db.prepare(
          `SELECT id, balance
           FROM MemberCard
           WHERE patientId = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}
           ORDER BY createdAt LIMIT 1`,
        ).get(String(charge.patientId), ...tenantParams(context.clinicId)) as { id: string; balance: number } | undefined;
        if (card) {
          console.warn(`[refund-flow] 原支付卡 ${String(charge.memberCardId ?? '')} 不可用，退款冲销回退到患者卡 ${card.id}`);
        }
      }
      if (card) {
        const newBalance = Math.max(0, Number(card.balance) - amount);
        this.db.prepare(
          `UPDATE MemberCard SET balance = ?, updatedAt = ? WHERE id = ?`,
        ).run(newBalance, now, card.id);
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
      }
    }

    const debt = this.db.prepare(
      `SELECT * FROM Debt WHERE chargeId = ? AND deletedAt IS NULL`,
    ).get(refundRow.chargeId) as Record<string, unknown> | undefined;
    if (debt && Number(debt.paidAmount ?? 0) > 0) {
      // 退款申请时 Debt.paidAmount 已被扣减 amount，驳回/取消需恢复原状（封顶 totalAmount）。
      const newDebtPaid = Math.min(Number(debt.totalAmount ?? 0), Number(debt.paidAmount) + amount);
      const debtStatus = newDebtPaid >= Number(debt.totalAmount ?? 0)
        ? 'PAID'
        : newDebtPaid > 0 ? 'PARTIAL' : 'UNPAID';
      this.db.prepare(
        `UPDATE Debt SET paidAmount = ?, status = ?, updatedAt = ? WHERE id = ?`,
      ).run(newDebtPaid, debtStatus, now, debt.id);
    }
  }
}
