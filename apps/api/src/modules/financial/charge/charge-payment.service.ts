import { Injectable } from '@nestjs/common';
import { DbService } from '../../../db/db.service';
import { IDatabase } from '../../../db/db.interface';
import { BaseService } from '../../../common/services/base.service';
import { ClinicContextService } from '../../../common/services/clinic-context.service';
import { IdempotencyService } from '../../../common/services/idempotency.service';
import { ChargeService } from './charge.service';
import { MemberCardsService } from '../member-cards/member-cards.service';
import { PayChargeDto } from './dto/pay-charge.dto';
import { ChargeStatusMachine } from './domain/charge-status-machine';
import { ChargeRecord } from './entities/charge.entity';
import { yuanToCents, centsToYuan, centsGreaterThan } from '../../../common/utils/format/money.utils';
import { EventBusService } from '../../../common/events/event-bus.service';
import { ChargePaidEvent } from '../../../common/events/domain-events';
import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { ChargeStatus } from '../../../common/constants';

@Injectable()
export class ChargePaymentService extends BaseService<ChargeRecord> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private idempotency: IdempotencyService,
    private chargeService: ChargeService,
    private memberCardsService: MemberCardsService,
    private eventBus: EventBusService,
  ) {
    super(dbService, clinicContext, {
      tableName: 'Charge',
      moneyFields: ['totalAmount', 'paidAmount', 'refundedAmount', 'discount'],
    });
  }

  async payCharge(id: string, dto: PayChargeDto, _operatorId?: string) {
    if (typeof dto.amount !== 'number' || !Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BusinessValidationException('支付金额必须为有效正数');
    }

    // 会员卡支付必须提供 memberCardId，否则会导致 Charge 标记为 PAID 但未实际扣款
    if (dto.payMethod === 'MEMBER_CARD' && !dto.memberCardId) {
      throw new BusinessValidationException('会员卡支付必须提供 memberCardId');
    }

    const doPay = (db: IDatabase) => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

      const charge = db.prepare(
        `SELECT id, totalAmount, paidAmount, refundedAmount, status FROM Charge WHERE id = ? AND deletedAt IS NULL${clinicClause}`
      ).get(id, ...clinicParams) as Record<string, unknown> | undefined;

      if (!charge) throw new BusinessNotFoundException('收费记录不存在');

      const totalAmountCents = Number(charge.totalAmount) || 0;
      const paidAmountCents = Number(charge.paidAmount) || 0;
      const refundedAmountCents = Number(charge.refundedAmount) || 0;

      // 净实收 = 已付 - 已退；待付金额须把退款部分算回来，否则部分退款后无法再收款
      const netPaidCents = paidAmountCents - refundedAmountCents;
      const remainingCents = totalAmountCents - netPaidCents;
      const remaining = centsToYuan(remainingCents);

      if (remainingCents <= 0) {
        throw new BusinessValidationException('该收费已结清');
      }

      if (charge.status === ChargeStatus.CANCELLED) {
        throw new BusinessValidationException('收费单已取消，不能付款');
      }

      const amountCents = yuanToCents(dto.amount);
      if (centsGreaterThan(amountCents, remainingCents)) {
        throw new BusinessValidationException(`支付金额不能超过待付金额 ${remaining.toFixed(2)}`);
      }

      const newPaidCents = paidAmountCents + amountCents;
      const newStatus = ChargeStatusMachine.resolveByPaymentCents(
        newPaidCents - refundedAmountCents,
        totalAmountCents,
      );
      ChargeStatusMachine.transition(charge.status as string, newStatus);

      const now = new Date().toISOString();

      const updateResult = db.prepare(
        `UPDATE Charge SET paidAmount = ?, status = ?, payMethod = ?, paidAt = ?, updatedAt = ? WHERE id = ?${clinicClause} AND deletedAt IS NULL AND paidAmount = ? AND (totalAmount - paidAmount + refundedAmount) >= ?`
      ).run(
        newPaidCents,
        newStatus,
        dto.payMethod || null,
        now,
        now,
        id,
        ...clinicParams,
        paidAmountCents,
        amountCents,
      );

      if (updateResult.changes === 0) {
        const currentCharge = db.prepare(
          `SELECT totalAmount, paidAmount, refundedAmount, status FROM Charge WHERE id = ?${clinicClause} AND deletedAt IS NULL`
        ).get(id, ...clinicParams) as Record<string, unknown> | undefined;
        if (!currentCharge) throw new BusinessNotFoundException('收费记录不存在');
        const currentPaidCents = Number(currentCharge.paidAmount) || 0;
        const currentRefundedCents = Number(currentCharge.refundedAmount) || 0;
        const currentRemainingCents = (Number(currentCharge.totalAmount) || 0) - currentPaidCents + currentRefundedCents;
        if (currentRemainingCents < amountCents) {
          throw new BusinessValidationException('待付金额不足，可能存在并发修改，请刷新后重试');
        }
        // P1 修复：paidAmount 已被并发修改（CAS 失败），提示用户刷新重试
        if (currentPaidCents !== paidAmountCents) {
          throw new BusinessValidationException('收费单已收到其他支付，请刷新后重试');
        }
        throw new BusinessValidationException('支付失败：并发冲突，请刷新后重试');
      }

      this.logAudit(db, 'CHARGE_PAY', id, 'Charge', {
        beforeData: { status: charge.status, paidAmount: centsToYuan(paidAmountCents) },
        afterData: { status: newStatus, paidAmount: centsToYuan(newPaidCents) },
      });

      return this.chargeService.getCharge(id);
    };

    const doFullPay = (db: IDatabase) => {
      const payResult = doPay(db);
      if (dto.payMethod === 'MEMBER_CARD' && dto.memberCardId) {
        // P0 修复：委托 MemberCardsService.consumeSync 消除重复代码
        // consumeSync 内部包含 CAS 保护（balance >= ?）、卡状态校验、流水记录、审计日志
        // 在同一事务内执行，保证收费与扣款原子性
        this.memberCardsService.consumeSync(db, dto.memberCardId, dto.amount, id, '收费消费');
      }
      return payResult;
    };

    let result;
    if (dto.requestId) {
      const idempotencyKey = `charge-pay:${id}:${dto.requestId}`;
      result = await this.idempotency.executeInTransaction(
        { key: idempotencyKey, type: 'CHARGE_PAY' },
        (db) => doFullPay(db),
      );
    } else {
      result = this.dbService.transaction((db) => doFullPay(db));
    }

    this.eventBus.emit(new ChargePaidEvent(id, result.patientId, dto.amount, this.clinicContext.getClinicId()));
    return result;
  }
}