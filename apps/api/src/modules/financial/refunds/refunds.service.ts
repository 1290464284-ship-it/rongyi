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
import { MemberCardLogType, DebtStatus, AuditLogType } from "../../../common/constants";
import { EventBusService } from '../../../common/events/event-bus.service';
import { RefundCreatedEvent } from '../../../common/events/domain-events';
import { RefundRepository } from './repositories/refund.repository';

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
    private eventBus: EventBusService,
    private refundRepository: RefundRepository,
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
    const chargeStatus = this.refundRepository.getChargeStatus(this.dbService, dto.chargeId, clinicClause, clinicParams);
    if (!chargeStatus) {
      this.logger.warn({
        message: '退款失败：收费记录不存在',
        chargeId: dto.chargeId,
        amount: dto.amount,
        operatorId: user?.id,
      });
      throw new BusinessNotFoundException("收费记录不存在");
    }
    if (chargeStatus.status === 'CANCELLED') {
      this.logger.warn({
        message: '退款失败：收费单已取消',
        chargeId: dto.chargeId,
        amount: dto.amount,
        chargeStatus: chargeStatus.status,
        operatorId: user?.id,
      });
      throw new BusinessValidationException("该收费单已取消，无法退款");
    }

    const refundId = crypto.randomUUID();
    const now = new Date().toISOString();
    const operatorId = user?.id || null;
    const operatorName = user?.name || null;
    const operatorIp = user?.ip || null;

    const doRefundInTx = (db: IDatabase) => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      const charge = this.refundRepository.findChargeForRefund(db, dto.chargeId, clinicClause, clinicParams);
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

      this.refundRepository.create(db, {
        id: refundId,
        chargeId: dto.chargeId,
        patientId: charge.patientId,
        amount: amountCents,
        reason: dto.reason || null,
        operatorId,
        operatorName,
        clinicId,
        createdAt: now,
      });

      const newRefundedCents = refundedAmountCents + amountCents;
      const newRefunded = centsToYuan(newRefundedCents);
      const chargeBefore = { paidAmount, refundedAmount, status: charge.status };
      const newStatus = ChargeStatusMachine.resolveByRefundCents(paidAmountCents, newRefundedCents, charge.status);
      ChargeStatusMachine.transition(charge.status, newStatus);
      const chargeUpdateResult = this.refundRepository.updateChargeRefund(db, dto.chargeId, newRefundedCents, newStatus, now, amountCents, clinicClause, clinicParams, refundedAmountCents);
      if (chargeUpdateResult.changes === 0) {
        throw new BusinessValidationException("退款金额超过可退额度，可能存在并发退款");
      }

      const memberCardRefundResult = this.refundMemberCardIfApplicable(db, {
        chargeId: dto.chargeId,
        refundAmount: dto.amount,
        patientId: charge.patientId,
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
    try {
      let result;
      if (idempotencyKey) {
        result = await this.idempotency.executeInTransaction(
          { key: idempotencyKey, type: "REFUND" },
          (db) => doRefundInTx(db),
        );
      } else {
        result = this.dbService.transaction((db) => doRefundInTx(db));
      }
      this.eventBus.emit(new RefundCreatedEvent(refundId, dto.chargeId, dto.amount, clinicId));
      return result;
    } catch (e: unknown) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.logger.error(
        {
          message: `退款失败: ${err.message}`,
          refundId,
          chargeId: dto.chargeId,
          amount: dto.amount,
          reason: dto.reason,
          operatorId,
          operatorName,
          idempotencyKey,
        },
        err,
      );
      throw e;
    }
  }

  private refundMemberCardIfApplicable(
    db: IDatabase,
    params: { chargeId: string; refundAmount: number; patientId: string; reason?: string; operatorId: string | null; now: string },
  ): { cardId: string; refundedAmount: number; balanceAfter: number } | null {
    const clinicId = this.clinicContext.getClinicId();
    const { chargeId, refundAmount, reason, now } = params;
    const refundAmountCents = yuanToCents(refundAmount);
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    const consumeRow = this.refundRepository.findMemberCardConsumeSum(db, chargeId, MemberCardLogType.CONSUME, clinicClause, clinicParams);
    if (!consumeRow) return null;

    const refundedRow = this.refundRepository.findMemberCardRefundSum(db, chargeId, MemberCardLogType.REFUND, clinicClause, clinicParams);

    const totalConsumedAbsCents = Math.abs(Number(consumeRow.totalConsumed) || 0);
    const totalAlreadyRefundedCents = Number(refundedRow.totalRefunded) || 0;
    const cardRefundableCents = totalConsumedAbsCents - totalAlreadyRefundedCents;
    const cardRefundable = centsToYuan(cardRefundableCents);
    if (cardRefundable <= 0) return null;

    const actualRefundCents = centsLessThanOrEqual(refundAmountCents, cardRefundableCents) ? refundAmountCents : cardRefundableCents;
    const actualRefund = centsToYuan(actualRefundCents);
    const cardId = consumeRow.cardId;

    const updateResult = this.refundRepository.updateMemberCardBalance(db, cardId, actualRefundCents, now, chargeId, clinicClause, clinicParams);
    if (updateResult.changes === 0) {
      const existingCard = this.refundRepository.getMemberCardFields(db, cardId, clinicClause, clinicParams);
      if (!existingCard) throw new BusinessValidationException("会员卡退款失败：卡不存在");
      throw new BusinessValidationException("会员卡可退金额不足，可能存在并发退款，请刷新后重试");
    }

    const updatedCard = this.refundRepository.getMemberCardFields(db, cardId, clinicClause, clinicParams);
    const balanceAfterCents = Number(updatedCard?.balance) || 0;
    const balanceAfter = centsToYuan(balanceAfterCents);

    this.refundRepository.createMemberCardLog(db, {
      id: crypto.randomUUID(),
      cardId,
      amount: actualRefundCents,
      balanceAfter: balanceAfterCents,
      chargeId,
      remark: reason || "收费退款",
      clinicId,
      createdAt: now,
    });

    return { cardId, refundedAmount: actualRefund, balanceAfter };
  }

  private syncDebtRecordOnRefund(
    db: IDatabase,
    params: { chargeId: string; refundAmount: number; now: string },
  ): { debtId: string; paidAmount: number; debtAmount: number; status: string } | null {
    const { chargeId, refundAmount, now } = params;
    const refundAmountCents = yuanToCents(refundAmount);

    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

    const debt = this.refundRepository.findDebtByCharge(db, chargeId, clinicClause, clinicParams);
    if (!debt) return null;

    const debtId = debt.id;
    const oldPaidCents = Math.max(0, Number(debt.paidAmount) || 0);
    const oldDebtCents = Number(debt.debtAmount) || 0;
    const reducePaidCents = centsLessThanOrEqual(refundAmountCents, oldPaidCents) ? refundAmountCents : oldPaidCents;
    const newPaidCents = oldPaidCents - reducePaidCents;
    const newPaid = centsToYuan(newPaidCents);
    const newDebtCents = oldDebtCents + reducePaidCents;
    const newDebt = centsToYuan(newDebtCents);
    const totalAmountCents = newDebtCents + newPaidCents;
    const newStatus = newPaidCents <= 0 ? DebtStatus.UNPAID : (newPaidCents < totalAmountCents ? DebtStatus.PARTIAL : DebtStatus.PAID);

    const updateResult = this.refundRepository.updateDebt(db, debtId, {
      paidAmount: newPaidCents,
      debtAmount: newDebtCents,
      status: newStatus,
      updatedAt: now,
      oldPaidAmount: oldPaidCents,
      oldDebtAmount: oldDebtCents,
    }, clinicClause, clinicParams);

    if (updateResult.changes === 0) {
      throw new BusinessValidationException("欠费记录并发修改，请刷新后重试");
    }

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