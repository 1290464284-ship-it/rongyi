import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { IdempotencyService } from "../../../common/services/idempotency.service";
import * as crypto from "crypto";
import { roundMoney, moneyGreaterThan, moneyGreaterThanOrEqual, moneyLessThanOrEqual } from "../../../common/utils/money.utils";

interface RefundDto {
  chargeId: string;
  amount: number;
  reason?: string;
  requestId?: string;
}

interface OperatorInfo {
  id?: string;
  name?: string;
  ip?: string;
}

/**
 * 退款服务
 *
 * P0.2 修复：退款流程必须在同一事务内完成以下全部副作用
 *   1. 写入 Refund 记录
 *   2. 更新 Charge.refundedAmount / status
 *   3. 若原支付方式为会员卡 → 回滚 MemberCard 余额（受历史已退款金额约束，避免超退）
 *   4. 若 Charge 存在关联 DebtRecord → 同步回滚 DebtRecord.paidAmount / debtAmount / status
 *   5. 写入 AuditLog 审计日志（财务操作必须留痕）
 *
 * 同事务保证：以上 5 步任一失败，整个回滚，避免"已退款未扣卡"或"已退款未审计"等财务漏洞。
 */
@Injectable()
export class RefundsService {
  constructor(
    private dbService: DbService,
    private idempotency: IdempotencyService,
  ) {}

  async create(dto: RefundDto, user?: OperatorInfo) {
    // P0.2: NaN/undefined 防御（NaN <= 0 为 false，原校验被绕过）
    if (typeof dto.amount !== "number" || !Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException("退款金额必须为有效正数");
    }

    const refundId = crypto.randomUUID();
    const now = new Date().toISOString();
    const operatorId = user?.id || null;
    const operatorName = user?.name || null;
    const operatorIp = user?.ip || null;

    // 统一的退款核心逻辑（接收 db 参数，便于复用到幂等/非幂等两条路径）
    const doRefundInTx = (db: any) => {
      const charge = db.prepare("SELECT * FROM Charge WHERE id = ? AND deletedAt IS NULL").get(dto.chargeId) as Record<string, unknown> | undefined;
      if (!charge) throw new NotFoundException("收费记录不存在");

      const paidAmount = Number(charge.paidAmount) || 0;
      const refundedAmount = Number(charge.refundedAmount) || 0;
      const refundable = roundMoney(paidAmount - refundedAmount);
      if (refundable <= 0) throw new BadRequestException("该收费无可退金额");
      if (moneyGreaterThan(dto.amount, refundable)) {
        throw new BadRequestException(`退款金额不能超过可退金额 ${refundable.toFixed(2)}`);
      }

      // 1. 写入 Refund 记录
      db.prepare(
        "INSERT INTO Refund (id, chargeId, patientId, amount, reason, operatorId, operatorName, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(refundId, dto.chargeId, charge.patientId, dto.amount, dto.reason || null, operatorId, operatorName, now);

      // 2. 更新 Charge.refundedAmount / status
      const newRefunded = roundMoney(refundedAmount + dto.amount);
      const chargeBefore = { paidAmount, refundedAmount, status: charge.status as string };
      const newStatus = moneyGreaterThanOrEqual(newRefunded, paidAmount) ? "REFUNDED" : (charge.status === "PAID" ? "PAID" : charge.status as string);
      db.prepare("UPDATE Charge SET refundedAmount = ?, status = ?, updatedAt = ? WHERE id = ?")
        .run(newRefunded, newStatus, now, dto.chargeId);

      // 3. 若原支付方式为会员卡 → 回滚会员卡余额
      //    通过 MemberCardLog 反查该 chargeId 的累计消费 - 累计退款，确保只退到卡的实际可退金额
      const memberCardRefundResult = this.refundMemberCardIfApplicable(db, {
        chargeId: dto.chargeId,
        refundAmount: dto.amount,
        patientId: charge.patientId as string,
        reason: dto.reason,
        operatorId,
        now,
      });

      // 4. 若 Charge 存在关联 DebtRecord → 同步回滚欠费
      const debtSyncResult = this.syncDebtRecordOnRefund(db, {
        chargeId: dto.chargeId,
        refundAmount: dto.amount,
        now,
      });

      // 5. 写入 AuditLog 审计日志（财务操作必须留痕）
      const auditBefore = JSON.stringify({ charge: chargeBefore });
      const auditAfter = JSON.stringify({
        charge: { refundedAmount: newRefunded, status: newStatus },
        memberCard: memberCardRefundResult,
        debt: debtSyncResult,
      });
      db.prepare(
        "INSERT INTO AuditLog (id, type, targetId, targetType, operatorId, operatorName, amount, beforeData, afterData, remark, ip, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        crypto.randomUUID(),
        "REFUND",
        dto.chargeId,
        "Charge",
        operatorId,
        operatorName,
        dto.amount,
        auditBefore,
        auditAfter,
        dto.reason || "退款",
        operatorIp,
        now,
      );

      return { id: refundId, amount: dto.amount, memberCard: memberCardRefundResult, debt: debtSyncResult };
    };

    // 幂等键路径：使用 IdempotencyService.executeInTransaction（内部已用事务包裹）
    const idempotencyKey = dto.requestId ? `refund:${dto.chargeId}:${dto.requestId}` : null;
    if (idempotencyKey) {
      return this.idempotency.executeInTransaction(
        { key: idempotencyKey, type: "REFUND" },
        (db) => doRefundInTx(db),
      );
    }

    // 非幂等路径：直接走 dbService.transaction
    return this.dbService.transaction((db) => doRefundInTx(db));
  }

  /**
   * 退款到会员卡：基于 MemberCardLog 历史精确计算可退金额，避免超退
   * 返回 null 表示该 charge 未通过会员卡支付，无需回滚。
   */
  private refundMemberCardIfApplicable(
    db: any,
    params: { chargeId: string; refundAmount: number; patientId: string; reason?: string; operatorId: string | null; now: string },
  ): { cardId: string; refundedAmount: number; balanceAfter: number } | null {
    const { chargeId, refundAmount, reason, now } = params;

    // 累计消费（CONSUME 为负值，amount 列存的是带符号的实际变动值）
    const consumeRow = db.prepare(
      "SELECT cardId, COALESCE(SUM(amount), 0) AS totalConsumed FROM MemberCardLog WHERE chargeId = ? AND type = 'CONSUME' GROUP BY cardId"
    ).get(chargeId) as { cardId: string; totalConsumed: number } | undefined;
    if (!consumeRow) return null;

    // 累计已退款（REFUND 为正值）
    const refundedRow = db.prepare(
      "SELECT COALESCE(SUM(amount), 0) AS totalRefunded FROM MemberCardLog WHERE chargeId = ? AND type = 'REFUND'"
    ).get(chargeId) as { totalRefunded: number };

    const totalConsumedAbs = Math.abs(Number(consumeRow.totalConsumed) || 0);
    const totalAlreadyRefunded = Number(refundedRow.totalRefunded) || 0;
    const cardRefundable = roundMoney(totalConsumedAbs - totalAlreadyRefunded);
    if (cardRefundable <= 0) return null;

    // 实际退到卡的金额 = min(本次退款金额, 卡可退金额)
    const actualRefund = moneyLessThanOrEqual(refundAmount, cardRefundable) ? refundAmount : cardRefundable;
    const cardId = consumeRow.cardId;

    // 原子更新：balance +, totalConsume -（受 totalConsume >= 0 约束避免负数）
    // 同时校验 status = 'ACTIVE'，DISABLED 卡也允许退款（解除冻结场景），但需要存在
    const updateResult = db.prepare(
      "UPDATE MemberCard SET balance = ROUND(balance + ?, 2), totalConsume = MAX(0, ROUND(totalConsume - ?, 2)), updatedAt = ? WHERE id = ?"
    ).run(actualRefund, actualRefund, now, cardId);
    if (updateResult.changes === 0) throw new BadRequestException("会员卡退款失败：卡不存在");

    const updatedCard = db.prepare("SELECT balance, totalConsume FROM MemberCard WHERE id = ?").get(cardId) as { balance: number; totalConsume: number };
    const balanceAfter = Number(updatedCard.balance) || 0;

    // 写入会员卡流水
    db.prepare(
      "INSERT INTO MemberCardLog (id, cardId, type, amount, balanceAfter, chargeId, remark, createdAt) VALUES (?, ?, 'REFUND', ?, ?, ?, ?, ?)"
    ).run(crypto.randomUUID(), cardId, actualRefund, balanceAfter, chargeId, reason || "收费退款", now);

    return { cardId, refundedAmount: actualRefund, balanceAfter };
  }

  /**
   * 退款时同步回滚欠费记录：付费已被记入 DebtRecord.paidAmount，退款时需要把这部分还原为欠款
   */
  private syncDebtRecordOnRefund(
    db: any,
    params: { chargeId: string; refundAmount: number; now: string },
  ): { debtId: string; paidAmount: number; debtAmount: number; status: string } | null {
    const { chargeId, refundAmount, now } = params;

    const debt = db.prepare("SELECT * FROM DebtRecord WHERE chargeId = ?").get(chargeId) as Record<string, unknown> | undefined;
    if (!debt) return null;

    const debtId = debt.id as string;
    const oldPaid = Number(debt.paidAmount) || 0;
    const oldDebt = Number(debt.debtAmount) || 0;
    // 还款时是从 paidAmount 减去，并加回 debtAmount，但不能让 paidAmount 变负
    const reducePaid = moneyLessThanOrEqual(refundAmount, oldPaid) ? refundAmount : oldPaid;
    const newPaid = roundMoney(oldPaid - reducePaid);
    const newDebt = roundMoney(oldDebt + reducePaid);
    const newStatus = newPaid <= 0 ? "UNPAID" : (newPaid < oldDebt + reducePaid ? "UNPAID" : "PAID");

    db.prepare(
      "UPDATE DebtRecord SET paidAmount = ?, debtAmount = ?, status = ?, updatedAt = ? WHERE id = ?"
    ).run(newPaid, newDebt, newStatus, now, debtId);

    return { debtId, paidAmount: newPaid, debtAmount: newDebt, status: newStatus };
  }

  async findByCharge(chargeId: string) {
    return this.dbService.prepare("SELECT * FROM Refund WHERE chargeId = ? AND deletedAt IS NULL ORDER BY createdAt DESC").all(chargeId);
  }

  async findMany(params: { patientId?: string; chargeId?: string }, page = 1, pageSize = 50) {
    const { patientId, chargeId } = params || {};
    const safePageSize = Math.min(200, Math.max(1, pageSize));
    let query = "SELECT * FROM Refund WHERE deletedAt IS NULL";
    let countQuery = "SELECT COUNT(*) as count FROM Refund WHERE deletedAt IS NULL";
    const qp: unknown[] = [];
    const cp: unknown[] = [];
    if (patientId) { query += " AND patientId = ?"; countQuery += " AND patientId = ?"; qp.push(patientId); cp.push(patientId); }
    if (chargeId) { query += " AND chargeId = ?"; countQuery += " AND chargeId = ?"; qp.push(chargeId); cp.push(chargeId); }
    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    qp.push(safePageSize, (page - 1) * safePageSize);
    const items = this.dbService.prepare(query).all(...qp);
    const total = (this.dbService.prepare(countQuery).get(...cp) as { count: number })?.count || 0;
    return { items, total, page, pageSize: safePageSize };
  }

  async findOne(id: string) {
    const r = this.dbService.prepare("SELECT * FROM Refund WHERE id = ? AND deletedAt IS NULL").get(id);
    if (!r) throw new NotFoundException("退款记录不存在");
    return r;
  }
}
