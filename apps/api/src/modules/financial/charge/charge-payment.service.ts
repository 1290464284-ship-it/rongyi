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
import { StatsService } from '../../system/stats/stats.service';
import * as crypto from 'node:crypto';
import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';

@Injectable()
export class ChargePaymentService extends BaseService<ChargeRecord> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private idempotency: IdempotencyService,
    private chargeService: ChargeService,
    private memberCardsService: MemberCardsService,
    private statsService: StatsService,
  ) {
    super(dbService, clinicContext, 'Charge', [], [], [], true, [], undefined, undefined, [
      'totalAmount', 'paidAmount', 'refundedAmount', 'discount',
    ]);
  }

  async payCharge(id: string, dto: PayChargeDto, _operatorId?: string) {
    if (typeof dto.amount !== 'number' || !Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BusinessValidationException('支付金额必须为有效正数');
    }

    const doPay = (db: IDatabase) => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();

      const charge = db.prepare(
        `SELECT id, totalAmount, paidAmount, refundedAmount, status FROM Charge WHERE id = ? AND deletedAt IS NULL${clinicClause}`
      ).get(id, ...clinicParams) as Record<string, unknown> | undefined;

      if (!charge) throw new BusinessNotFoundException('收费记录不存在');

      const totalAmountCents = Number(charge.totalAmount) || 0;
      const paidAmountCents = Number(charge.paidAmount) || 0;
      const _refundedAmountCents = Number(charge.refundedAmount) || 0;
      const totalAmount = centsToYuan(totalAmountCents);

      const remainingCents = totalAmountCents - paidAmountCents;
      const remaining = centsToYuan(remainingCents);

      if (remaining <= 0) {
        throw new BusinessValidationException('该收费已结清');
      }

      const amountCents = yuanToCents(dto.amount);
      if (centsGreaterThan(amountCents, remainingCents)) {
        throw new BusinessValidationException(`支付金额不能超过待付金额 ${remaining.toFixed(2)}`);
      }

      const newPaidCents = paidAmountCents + amountCents;
      const newPaid = centsToYuan(newPaidCents);
      const newStatus = ChargeStatusMachine.resolveByPayment(newPaid, totalAmount);
      ChargeStatusMachine.transition(charge.status as string, newStatus);

      const now = new Date().toISOString();

      const updateResult = db.prepare(
        `UPDATE Charge SET paidAmount = ?, status = ?, payMethod = ?, paidAt = ?, updatedAt = ? WHERE id = ?${clinicClause} AND deletedAt IS NULL AND (totalAmount - paidAmount) >= ?`
      ).run(
        newPaidCents,
        newStatus,
        dto.payMethod || null,
        now,
        now,
        id,
        ...clinicParams,
        amountCents,
      );

      if (updateResult.changes === 0) {
        const currentCharge = db.prepare(
          `SELECT totalAmount, paidAmount, status FROM Charge WHERE id = ?${clinicClause} AND deletedAt IS NULL`
        ).get(id, ...clinicParams) as Record<string, unknown> | undefined;
        if (!currentCharge) throw new BusinessNotFoundException('收费记录不存在');
        const remaining = Number(currentCharge.totalAmount) - Number(currentCharge.paidAmount);
        if (remaining < amountCents) {
          throw new BusinessValidationException('待付金额不足，可能存在并发修改，请刷新后重试');
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
        const amountCents = yuanToCents(dto.amount);
        const now = new Date().toISOString();
        const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
        const card = db.prepare(
          `SELECT id, status, balance FROM MemberCard WHERE id = ?${clinicClause}`
        ).get(dto.memberCardId, ...clinicParams) as Record<string, unknown> | undefined;
        if (!card) throw new BusinessValidationException('会员卡不存在');
        if (card.status !== 'ACTIVE') throw new BusinessValidationException('会员卡状态异常，无法消费');
        const updateResult = db.prepare(
          `UPDATE MemberCard SET balance = balance - ?, totalConsume = totalConsume + ?, updatedAt = ? WHERE id = ? AND status = 'ACTIVE' AND balance >= ?${clinicClause}`
        ).run(amountCents, amountCents, now, dto.memberCardId, amountCents, ...clinicParams);
        if (updateResult.changes === 0) {
          throw new BusinessValidationException('会员卡余额不足');
        }
        const updatedCard = db.prepare(
          `SELECT balance, totalConsume FROM MemberCard WHERE id = ?${clinicClause}`
        ).get(dto.memberCardId, ...clinicParams) as Record<string, unknown>;
        const newBalanceCents = Number(updatedCard.balance) || 0;
        const clinicId = this.clinicContext.getClinicId();
        db.prepare(
          "INSERT INTO MemberCardLog (id, cardId, type, amount, balanceAfter, chargeId, remark, clinicId, createdAt) VALUES (?,?,?,?,?,?,?,?,?)"
        ).run(
          crypto.randomUUID(),
          dto.memberCardId,
          'CONSUME',
          -amountCents,
          newBalanceCents,
          id,
          '收费消费',
          clinicId,
          now,
        );
        this.logAudit(db, 'MEMBER_CARD_CONSUME', dto.memberCardId, 'MemberCard', {
          beforeData: { balance: centsToYuan(Number(card.balance) || 0) },
          afterData: { balance: centsToYuan(newBalanceCents) },
        });
      }
      return payResult;
    };

    if (dto.requestId) {
      const idempotencyKey = `charge-pay:${id}:${dto.requestId}`;
      const result = await this.idempotency.executeInTransaction(
        { key: idempotencyKey, type: 'CHARGE_PAY' },
        (db) => doFullPay(db),
      );
      this.invalidatePaymentStatsCaches();
      return result;
    }

    const result = this.dbService.transaction((db) => doFullPay(db));
    this.invalidatePaymentStatsCaches();
    return result;
  }

  /** 支付成功后统一失效受影响的统计缓存 */
  private invalidatePaymentStatsCaches() {
    this.statsService.invalidateStatsCache('dashboard');
    this.statsService.invalidateStatsCache('revenue');
    this.statsService.invalidateStatsCache('charge');
    this.statsService.invalidateStatsCache('doctorWorkload');
    this.statsService.invalidateStatsCache('revenueByDoctor');
    this.statsService.invalidateStatsCache('revenueByCategory');
    this.statsService.invalidateStatsCache('member');
  }
}