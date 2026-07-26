import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { IDatabase } from "../../../db/db.interface";
import { BaseService } from "../../../common/services/base.service";
import { IdempotencyService } from "../../../common/services/idempotency.service";
import * as crypto from "node:crypto";
import { yuanToCents, centsToYuan, centsGreaterThan, centsLessThanOrEqual } from "../../../common/utils/format/money.utils";
import { ChargeStatusMachine } from "../charge/domain/charge-status-machine";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { Refund } from "@dental/shared";
import { MemberCardStatus, MemberCardLogType, DebtStatus, AuditLogType } from "../../../common/constants";
import { StatsService } from '../../system/stats/stats.service';

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

@Injectable()
export class RefundsService extends BaseService<Refund> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private idempotency: IdempotencyService,
    private statsService: StatsService,
  ) {
    super(dbService, clinicContext, 'Refund', [], [], [], true, [], undefined, undefined, ['amount']);
  }

  async createRefund(dto: RefundDto, user?: OperatorInfo) {
    const clinicId = this.clinicContext.getClinicId();

    if (typeof dto.amount !== "number" || !Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BusinessValidationException("退款金额必须为有效正数");
    }

    // Check charge status before processing
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const charge = this.dbService.prepare(`SELECT status FROM Charge WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(dto.chargeId, ...clinicParams) as { status: string } | undefined;
    if (!charge) {
      throw new BusinessNotFoundException("收费记录不存在");
    }
    if (charge.status === 'CANCELLED') {
      throw new BusinessValidationException("该收费单已取消，无法退款");
    }

    const refundId = crypto.randomUUID();
    const now = new Date().toISOString();
    const operatorId = user?.id || null;
    const operatorName = user?.name || null;
    const operatorIp = user?.ip || null;

    const doRefundInTx = (db: IDatabase) => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      const charge = db.prepare(`SELECT id, patientId, totalAmount, paidAmount, refundedAmount, status, payMethod FROM Charge WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(dto.chargeId, ...clinicParams) as Record<string, unknown> | undefined;
      if (!charge) throw new BusinessNotFoundException("收费记录不存在");

      const paidAmountCents = Number(charge.paidAmount) || 0;
      const refundedAmountCents = Number(charge.refundedAmount) || 0;
      const paidAmount = centsToYuan(paidAmountCents);
      const refundedAmount = centsToYuan(refundedAmountCents);
      const refundableCents = paidAmountCents - refundedAmountCents;
      const refundable = centsToYuan(refundableCents);
      const amountCents = yuanToCents(dto.amount);
      if (refundable <= 0) throw new BusinessValidationException("该收费无可退金额");
      if (centsGreaterThan(amountCents, refundableCents)) {
        throw new BusinessValidationException(`退款金额不能超过可退金额 ${refundable.toFixed(2)}`);
      }

      db.prepare(
        "INSERT INTO Refund (id, chargeId, patientId, amount, reason, operatorId, operatorName, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(refundId, dto.chargeId, charge.patientId, amountCents, dto.reason || null, operatorId, operatorName, clinicId, now);

      const newRefundedCents = refundedAmountCents + amountCents;
      const newRefunded = centsToYuan(newRefundedCents);
      const chargeBefore = { paidAmount, refundedAmount, status: charge.status as string };
      const newStatus = ChargeStatusMachine.resolveByRefund(paidAmount, newRefunded, charge.status as string);
      ChargeStatusMachine.transition(charge.status as string, newStatus);
      const chargeUpdateResult = db.prepare(`UPDATE Charge SET refundedAmount = ?, status = ?, updatedAt = ? WHERE id = ?${clinicClause} AND refundedAmount + ? <= paidAmount`)
        .run(newRefundedCents, newStatus, now, dto.chargeId, ...clinicParams, amountCents);
      if (chargeUpdateResult.changes === 0) {
        throw new BusinessValidationException("退款金额超过可退额度，可能存在并发退款");
      }

      const memberCardRefundResult = this.refundMemberCardIfApplicable(db, {
        chargeId: dto.chargeId,
        refundAmount: dto.amount,
        patientId: charge.patientId as string,
        reason: dto.reason,
        operatorId,
        now,
      });

      const debtSyncResult = this.syncDebtRecordOnRefund(db, {
        chargeId: dto.chargeId,
        refundAmount: dto.amount,
        now,
      });

      this.logAudit(db, AuditLogType.REFUND, dto.chargeId, "Charge", {
        operatorId,
        operatorName,
        ip: operatorIp,
        amount: dto.amount,
        beforeData: { charge: chargeBefore },
        afterData: {
          charge: { refundedAmount: newRefunded, status: newStatus },
          memberCard: memberCardRefundResult,
          debt: debtSyncResult,
        },
        remark: dto.reason || "退款",
      });

      return { id: refundId, amount: dto.amount, memberCard: memberCardRefundResult, debt: debtSyncResult };
    };

    const idempotencyKey = dto.requestId ? `refund:${dto.chargeId}:${dto.requestId}` : null;
    if (idempotencyKey) {
      const result = await this.idempotency.executeInTransaction(
        { key: idempotencyKey, type: "REFUND" },
        (db) => doRefundInTx(db),
      );
      this.statsService.invalidateStatsCache('dashboard');
      this.statsService.invalidateStatsCache('revenue');
      this.statsService.invalidateStatsCache('charge');
      this.statsService.invalidateStatsCache('doctorWorkload');
      this.statsService.invalidateStatsCache('revenueByDoctor');
      this.statsService.invalidateStatsCache('revenueByCategory');
      this.statsService.invalidateStatsCache('member');
      return result;
    }

    const result = this.dbService.transaction((db) => doRefundInTx(db));
    this.statsService.invalidateStatsCache('dashboard');
    this.statsService.invalidateStatsCache('revenue');
    this.statsService.invalidateStatsCache('charge');
    this.statsService.invalidateStatsCache('doctorWorkload');
    this.statsService.invalidateStatsCache('revenueByDoctor');
    this.statsService.invalidateStatsCache('revenueByCategory');
    this.statsService.invalidateStatsCache('member');
    return result;
  }

  private refundMemberCardIfApplicable(
    db: IDatabase,
    params: { chargeId: string; refundAmount: number; patientId: string; reason?: string; operatorId: string | null; now: string },
  ): { cardId: string; refundedAmount: number; balanceAfter: number } | null {
    const clinicId = this.clinicContext.getClinicId();
    const { chargeId, refundAmount, reason, now } = params;
    const refundAmountCents = yuanToCents(refundAmount);
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    const consumeRow = db.prepare(
      `SELECT cardId, COALESCE(SUM(amount), 0) AS totalConsumed FROM MemberCardLog WHERE chargeId = ? AND type = ?${clinicClause} GROUP BY cardId`
    ).get(chargeId, MemberCardLogType.CONSUME, ...clinicParams) as { cardId: string; totalConsumed: number } | undefined;
    if (!consumeRow) return null;

    const refundedRow = db.prepare(
      `SELECT COALESCE(SUM(amount), 0) AS totalRefunded FROM MemberCardLog WHERE chargeId = ? AND type = ?${clinicClause}`
    ).get(chargeId, MemberCardLogType.REFUND, ...clinicParams) as { totalRefunded: number };

    const totalConsumedAbsCents = Math.abs(Number(consumeRow.totalConsumed) || 0);
    const totalAlreadyRefundedCents = Number(refundedRow.totalRefunded) || 0;
    const cardRefundableCents = totalConsumedAbsCents - totalAlreadyRefundedCents;
    const cardRefundable = centsToYuan(cardRefundableCents);
    if (cardRefundable <= 0) return null;

    const actualRefundCents = centsLessThanOrEqual(refundAmountCents, cardRefundableCents) ? refundAmountCents : cardRefundableCents;
    const actualRefund = centsToYuan(actualRefundCents);
    const cardId = consumeRow.cardId;

    const updateResult = db.prepare(
      `UPDATE MemberCard SET balance = balance + ?, totalConsume = MAX(0, totalConsume - ?), updatedAt = ? WHERE id = ? AND status = ?${clinicClause}`
    ).run(actualRefundCents, actualRefundCents, now, cardId, MemberCardStatus.ACTIVE, ...clinicParams);
    if (updateResult.changes === 0) {
      const existingCard = db.prepare(`SELECT status FROM MemberCard WHERE id = ?${clinicClause}`).get(cardId, ...clinicParams) as { status: string } | undefined;
      if (!existingCard) throw new BusinessValidationException("会员卡退款失败：卡不存在");
      if (existingCard.status !== MemberCardStatus.ACTIVE) throw new BusinessValidationException("会员卡已禁用，无法退款");
      throw new BusinessValidationException("会员卡退款失败");
    }

    const updatedCard = db.prepare(`SELECT balance, totalConsume FROM MemberCard WHERE id = ?${clinicClause}`).get(cardId, ...clinicParams) as { balance: number; totalConsume: number };
    const balanceAfterCents = Number(updatedCard.balance) || 0;
    const balanceAfter = centsToYuan(balanceAfterCents);

    db.prepare(
      "INSERT INTO MemberCardLog (id, cardId, type, amount, balanceAfter, chargeId, remark, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(crypto.randomUUID(), cardId, MemberCardLogType.REFUND, actualRefundCents, balanceAfterCents, chargeId, reason || "收费退款", clinicId || null, now);

    return { cardId, refundedAmount: actualRefund, balanceAfter };
  }

  private syncDebtRecordOnRefund(
    db: IDatabase,
    params: { chargeId: string; refundAmount: number; now: string },
  ): { debtId: string; paidAmount: number; debtAmount: number; status: string } | null {
    const { chargeId, refundAmount, now } = params;
    const refundAmountCents = yuanToCents(refundAmount);

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    const debt = db.prepare(`SELECT id, totalAmount, paidAmount, debtAmount, status FROM DebtRecord WHERE chargeId = ? AND deletedAt IS NULL${clinicClause}`).get(chargeId, ...clinicParams) as Record<string, unknown> | undefined;
    if (!debt) return null;

    const debtId = debt.id as string;
    const oldPaidCents = Math.max(0, Number(debt.paidAmount) || 0);
    const oldDebtCents = Number(debt.debtAmount) || 0;
    const reducePaidCents = centsLessThanOrEqual(refundAmountCents, oldPaidCents) ? refundAmountCents : oldPaidCents;
    const newPaidCents = oldPaidCents - reducePaidCents;
    const newPaid = centsToYuan(newPaidCents);
    const newDebtCents = oldDebtCents + reducePaidCents;
    const newDebt = centsToYuan(newDebtCents);
    const totalAmountCents = newDebtCents + newPaidCents;
    const newStatus = newPaidCents <= 0 ? DebtStatus.UNPAID : (newPaidCents < totalAmountCents ? DebtStatus.PARTIAL : DebtStatus.PAID);

    db.prepare(
      `UPDATE DebtRecord SET paidAmount = ?, debtAmount = ?, status = ?, updatedAt = ? WHERE id = ? AND deletedAt IS NULL${clinicClause}`
    ).run(newPaidCents, newDebtCents, newStatus, now, debtId, ...clinicParams);

    return { debtId, paidAmount: newPaid, debtAmount: newDebt, status: newStatus };
  }

  async findByCharge(chargeId: string) {
    const refunds = await this.findMany({
      filters: { chargeId },
      sortBy: 'createdAt',
      sortOrder: 'DESC',
    });
    return refunds.items;
  }
}