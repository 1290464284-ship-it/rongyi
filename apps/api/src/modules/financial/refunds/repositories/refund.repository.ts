import { Injectable } from '@nestjs/common';
import * as crypto from 'node:crypto';

import { SqlExecutor } from '../../../../common/repositories/base.repository';
import { Refund } from '@dental/shared';

export interface CreateRefundData {
  id: string;
  chargeId: string;
  patientId: string;
  amount: number;
  reason?: string | null;
  operatorId?: string | null;
  operatorName?: string | null;
  clinicId?: string | null;
  createdAt: string;
}

export interface RefundMemberCardLogData {
  id: string;
  cardId: string;
  amount: number;
  balanceAfter: number;
  chargeId: string;
  remark?: string | null;
  clinicId?: string | null;
  createdAt: string;
}

export interface UpdateDebtData {
  paidAmount: number;
  debtAmount: number;
  status: string;
  updatedAt: string;
  /** 读取时的旧值，用于乐观锁 CAS 校验，防止并发还款覆盖 */
  oldPaidAmount: number;
  oldDebtAmount: number;
}

@Injectable()
export class RefundRepository {
  private readonly tableName = 'Refund';

  create(db: SqlExecutor, data: CreateRefundData): void {
    db.prepare(
      `INSERT INTO ${this.tableName} (id, chargeId, patientId, amount, reason, operatorId, operatorName, clinicId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      data.id,
      data.chargeId,
      data.patientId,
      data.amount,
      data.reason ?? null,
      data.operatorId ?? null,
      data.operatorName ?? null,
      data.clinicId ?? null,
      data.createdAt,
    );
  }

  update(
    db: SqlExecutor,
    id: string,
    updates: string[],
    params: unknown[],
    clinicClause: string,
    clinicParams: unknown[],
  ): void {
    if (updates.length === 0) return;
    db.prepare(
      `UPDATE ${this.tableName} SET ${updates.join(', ')} WHERE id = ?${clinicClause}`,
    ).run(...params, id, ...clinicParams);
  }

  findById(
    db: SqlExecutor,
    id: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): Refund | undefined {
    return db.prepare(
      `SELECT id, chargeId, patientId, amount, reason, operatorId, operatorName, clinicId, createdAt
       FROM ${this.tableName}
       WHERE id = ?${clinicClause}`,
    ).get(id, ...clinicParams) as Refund | undefined;
  }

  findMany(
    db: SqlExecutor,
    options: {
      clinicClause: string;
      clinicParams: unknown[];
      patientId?: string;
      chargeId?: string;
      page: number;
      pageSize: number;
      sortBy: string;
      sortOrder: 'ASC' | 'DESC';
    },
  ): { items: Refund[]; total: number } {
    const { clinicClause, clinicParams, patientId, chargeId, page, pageSize, sortBy, sortOrder } = options;

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (clinicClause) {
      const cleanClause = clinicClause.replace(/^\s*AND\s+/i, '');
      conditions.push(cleanClause);
      params.push(...clinicParams);
    }

    if (patientId) {
      conditions.push('patientId = ?');
      params.push(patientId);
    }
    if (chargeId) {
      conditions.push('chargeId = ?');
      params.push(chargeId);
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    const countSql = `SELECT COUNT(*) as total FROM ${this.tableName}${whereClause}`;
    const total = (db.prepare(countSql).get(...params) as { total: number } | undefined)?.total || 0;

    const dataSql = `SELECT id, chargeId, patientId, amount, reason, operatorId, operatorName, clinicId, createdAt
                     FROM ${this.tableName}${whereClause}
                     ORDER BY ${sortBy} ${sortOrder}, id ${sortOrder}
                     LIMIT ? OFFSET ?`;
    const dataParams = [...params, pageSize, (page - 1) * pageSize];
    const items = db.prepare(dataSql).all(...dataParams) as Refund[];

    return { items, total };
  }

  delete(
    db: SqlExecutor,
    id: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): void {
    db.prepare(
      `DELETE FROM ${this.tableName} WHERE id = ?${clinicClause}`,
    ).run(id, ...clinicParams);
  }

  findChargeForRefund(
    db: SqlExecutor,
    chargeId: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): { id: string; patientId: string; totalAmount: number; paidAmount: number; refundedAmount: number; status: string; payMethod?: string | null } | undefined {
    return db.prepare(
      `SELECT id, patientId, totalAmount, paidAmount, refundedAmount, status, payMethod
       FROM Charge WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
    ).get(chargeId, ...clinicParams) as { id: string; patientId: string; totalAmount: number; paidAmount: number; refundedAmount: number; status: string; payMethod?: string | null } | undefined;
  }

  getChargeStatus(
    db: SqlExecutor,
    chargeId: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): { status: string } | undefined {
    return db.prepare(
      `SELECT status FROM Charge WHERE id = ? AND deletedAt IS NULL${clinicClause}`,
    ).get(chargeId, ...clinicParams) as { status: string } | undefined;
  }

  updateChargeRefund(
    db: SqlExecutor,
    chargeId: string,
    newRefundedCents: number,
    newStatus: string,
    now: string,
    amountCents: number,
    clinicClause: string,
    clinicParams: unknown[],
    oldRefundedCents: number,
  ): { changes: number } {
    // P1 修复：增加精确 CAS `AND refundedAmount = ?` 防止并发退款"丢失更新"
    // 原先仅 `refundedAmount + ? <= paidAmount` 检查总量，两个并发退款各读 refunded=0，
    // 各自 newRefunded=50，CAS 均通过，最终 refunded=50（应为 100），丢失 50 元
    return db.prepare(
      `UPDATE Charge SET refundedAmount = ?, status = ?, updatedAt = ? WHERE id = ?${clinicClause} AND refundedAmount = ? AND refundedAmount + ? <= paidAmount`,
    ).run(newRefundedCents, newStatus, now, chargeId, ...clinicParams, oldRefundedCents, amountCents);
  }

  findMemberCardConsumeSum(
    db: SqlExecutor,
    chargeId: string,
    type: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): { cardId: string; totalConsumed: number } | undefined {
    return db.prepare(
      `SELECT cardId, COALESCE(SUM(amount), 0) AS totalConsumed FROM MemberCardLog WHERE chargeId = ? AND type = ?${clinicClause} GROUP BY cardId`,
    ).get(chargeId, type, ...clinicParams) as { cardId: string; totalConsumed: number } | undefined;
  }

  findMemberCardRefundSum(
    db: SqlExecutor,
    chargeId: string,
    type: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): { totalRefunded: number } {
    return db.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS totalRefunded FROM MemberCardLog WHERE chargeId = ? AND type = ?${clinicClause}`,
    ).get(chargeId, type, ...clinicParams) as { totalRefunded: number };
  }

  updateMemberCardBalance(
    db: SqlExecutor,
    cardId: string,
    refundCents: number,
    now: string,
    chargeId: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): { changes: number } {
    // 乐观锁 + 上限校验：通过子查询保证累计退款不超过累计消费，防止并发退款双倍返还
    // CONSUME 流水的 amount 为负数（消费），取 ABS 求和；REFUND 流水的 amount 为正数（退款）
    return db.prepare(
      `UPDATE MemberCard SET balance = balance + ?, totalConsume = MAX(0, totalConsume - ?), updatedAt = ?
       WHERE id = ? AND status = ?${clinicClause}
         AND ? <= (
           SELECT COALESCE(SUM(ABS(amount)), 0) FROM MemberCardLog WHERE cardId = ? AND type = 'CONSUME' AND chargeId = ?
         ) - (
           SELECT COALESCE(SUM(amount), 0) FROM MemberCardLog WHERE cardId = ? AND type = 'REFUND' AND chargeId = ?
         )`,
    ).run(refundCents, refundCents, now, cardId, 'ACTIVE', ...clinicParams, refundCents, cardId, chargeId, cardId, chargeId);
  }

  getMemberCardFields(
    db: SqlExecutor,
    cardId: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): { balance: number; totalConsume: number } | undefined {
    return db.prepare(
      `SELECT balance, totalConsume FROM MemberCard WHERE id = ?${clinicClause}`,
    ).get(cardId, ...clinicParams) as { balance: number; totalConsume: number } | undefined;
  }

  createMemberCardLog(db: SqlExecutor, data: RefundMemberCardLogData): void {
    db.prepare(
      `INSERT INTO MemberCardLog (id, cardId, type, amount, balanceAfter, chargeId, remark, clinicId, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      data.id,
      data.cardId,
      'REFUND',
      data.amount,
      data.balanceAfter,
      data.chargeId,
      data.remark ?? null,
      data.clinicId ?? null,
      data.createdAt,
    );
  }

  findDebtByCharge(
    db: SqlExecutor,
    chargeId: string,
    clinicClause: string,
    clinicParams: unknown[],
  ): { id: string; totalAmount: number; paidAmount: number; debtAmount: number; status: string } | undefined {
    return db.prepare(
      `SELECT id, totalAmount, paidAmount, debtAmount, status FROM DebtRecord WHERE chargeId = ? AND deletedAt IS NULL${clinicClause}`,
    ).get(chargeId, ...clinicParams) as { id: string; totalAmount: number; paidAmount: number; debtAmount: number; status: string } | undefined;
  }

  updateDebt(
    db: SqlExecutor,
    debtId: string,
    data: UpdateDebtData,
    clinicClause: string,
    clinicParams: unknown[],
  ): { changes: number } {
    // 乐观锁 CAS：要求读取时的 paidAmount/debtAmount 未被并发修改
    return db.prepare(
      `UPDATE DebtRecord SET paidAmount = ?, debtAmount = ?, status = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND paidAmount = ? AND debtAmount = ?${clinicClause}`,
    ).run(data.paidAmount, data.debtAmount, data.status, data.updatedAt, debtId, data.oldPaidAmount, data.oldDebtAmount, ...clinicParams);
  }
}
