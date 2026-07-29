import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { IDatabase } from "../../../db/db.interface";
import { BaseService } from "../../../common/services/base.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { yuanToCents, centsToYuan } from "../../../common/utils/format/money.utils";
import { IdempotencyService } from "../../../common/services/idempotency.service";
import { MemberCardStatus, MemberCardLogType, AuditLogType } from "../../../common/constants";
import { EventBusService } from '../../../common/events/event-bus.service';
import { MemberCardRechargedEvent, MemberCardConsumedEvent } from '../../../common/events/domain-events';
import { MemberCardLogRepository } from "./repositories/member-card-log.repository";
import { MemberCard, MemberCardRow } from './member-cards.service';

@Injectable()
export class MemberCardBalanceService extends BaseService<MemberCard> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private idempotency: IdempotencyService,
    private readonly memberCardLogRepo: MemberCardLogRepository,
    private eventBus: EventBusService,
  ) {
    super(dbService, clinicContext, { tableName: "MemberCard", uniqueFields: ["cardNo"], moneyFields: ['balance', 'totalRecharge', 'totalConsume'] });
  }

  private validatePositiveAmount(amount: number, message: string): void {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new BusinessValidationException(message);
    }
  }

  private getCardForUpdate(db: IDatabase, id: string, fields: string): MemberCardRow | undefined {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    return db.prepare(
      `SELECT ${fields} FROM MemberCard WHERE id = ? AND deletedAt IS NULL${clinicClause}`
    ).get(id, ...clinicParams) as MemberCardRow | undefined;
  }

  private getCardField(db: IDatabase, id: string, field: string): number {
    const card = this.getCardForUpdate(db, id, field);
    return card ? Number((card as unknown as Record<string, unknown>)[field]) || 0 : 0;
  }

  private assertCardExists(card: MemberCardRow | undefined): asserts card is MemberCardRow {
    if (!card) throw new BusinessNotFoundException('会员卡不存在');
  }

  private assertCardActive(card: MemberCardRow, errorMessage: string): void {
    if (card.status !== MemberCardStatus.ACTIVE) {
      throw new BusinessValidationException(errorMessage);
    }
  }

  private executeWithIdempotency<T>(
    idempotencyKey: string | null,
    auditType: string,
    handler: (db: IDatabase) => T,
  ): T {
    if (idempotencyKey) {
      return this.idempotency.executeInTransaction(
        { key: idempotencyKey, type: auditType },
        (db) => handler(db),
      );
    }
    return this.dbService.transaction((db) => handler(db));
  }

  async recharge(id: string, amount: number, requestId?: string) {
    this.validatePositiveAmount(amount, "充值/消费/退款金额必须为有效正数");
    const amountCents = yuanToCents(amount);
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();

    const doRecharge = (db: IDatabase) => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      const card = db.prepare(`SELECT id, patientId, status, balance FROM MemberCard WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as MemberCardRow & { patientId: string };
      this.assertCardExists(card);
      const result = db.prepare(`UPDATE MemberCard SET balance = balance + ?, totalRecharge = totalRecharge + ?, updatedAt = ? WHERE id = ? AND status = ?${clinicClause}`)
        .run(amountCents, amountCents, now, id, MemberCardStatus.ACTIVE, ...clinicParams);
      if (result.changes === 0) {
        const currentCard = db.prepare(`SELECT status FROM MemberCard WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as MemberCardRow | undefined;
        this.assertCardExists(currentCard);
        this.assertCardActive(currentCard, '会员卡已禁用，无法充值');
        throw new BusinessValidationException("充值失败：更新余额失败");
      }
      const newBalanceCents = this.getCardField(db, id, 'balance');
      const newTotalCents = this.getCardField(db, id, 'totalRecharge');
      const newBalance = centsToYuan(newBalanceCents);
      const newTotal = centsToYuan(newTotalCents);

      this.memberCardLogRepo.create(db, {
        cardId: id,
        type: MemberCardLogType.RECHARGE,
        amount: amountCents,
        balanceAfter: newBalanceCents,
        clinicId: clinicId || undefined,
      }, now);

      this.logAudit(
        db,
        AuditLogType.MEMBER_CARD_RECHARGE,
        id,
        "MemberCard",
        {
          beforeData: { balance: centsToYuan(Number(card.balance) || 0) },
          afterData: { balance: newBalance },
        },
      );

      return { id, patientId: card.patientId, balance: newBalance, totalRecharge: newTotal };
    };

    const idempotencyKey = requestId ? `member-card-recharge:${id}:${requestId}` : null;
    const result = this.executeWithIdempotency(idempotencyKey, AuditLogType.MEMBER_CARD_RECHARGE, doRecharge);

    this.eventBus.emit(new MemberCardRechargedEvent(id, result.patientId, amount, result.balance, clinicId));

    return result;
  }

  async consume(id: string, amount: number, chargeId?: string, remark?: string, requestId?: string) {
    this.validatePositiveAmount(amount, "充值/消费/退款金额必须为有效正数");

    const doConsume = (db: IDatabase) => this.consumeSync(db, id, amount, chargeId, remark);

    const idempotencyKey = requestId ? `member-card-consume:${id}:${requestId}` : null;
    const result = this.executeWithIdempotency(idempotencyKey, AuditLogType.MEMBER_CARD_CONSUME, doConsume);

    const clinicId = this.clinicContext.getClinicId();
    this.eventBus.emit(new MemberCardConsumedEvent(id, result.patientId, amount, result.balance, clinicId));

    return result;
  }

  /**
   * 同步消费会员卡（可在已有事务内调用）
   * P0 修复：提取为公共方法，供 ChargePaymentService 委托调用，消除重复代码
   * 包含 CAS 保护（balance >= ?）防止并发消费导致负余额
   */
  consumeSync(db: IDatabase, id: string, amount: number, chargeId?: string, remark?: string) {
    this.validatePositiveAmount(amount, "充值/消费/退款金额必须为有效正数");
    const amountCents = yuanToCents(amount);
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const card = db.prepare(`SELECT id, patientId, status, balance FROM MemberCard WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as MemberCardRow & { patientId: string };
    this.assertCardExists(card);
    this.assertCardActive(card, '会员卡状态异常，无法消费');
    const result = db.prepare(
      `UPDATE MemberCard SET balance = balance - ?, totalConsume = totalConsume + ?, updatedAt = ? WHERE id = ? AND status = ? AND balance >= ?${clinicClause}`
    ).run(amountCents, amountCents, now, id, MemberCardStatus.ACTIVE, amountCents, ...clinicParams);
    if (result.changes === 0) {
      const currentCard = db.prepare(`SELECT balance, status FROM MemberCard WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as MemberCardRow;
      if (!currentCard || currentCard.status !== MemberCardStatus.ACTIVE) throw new BusinessValidationException('会员卡状态异常');
      throw new BusinessValidationException('余额不足');
    }
    const newBalanceCents = this.getCardField(db, id, 'balance');
    const newTotalConsumeCents = this.getCardField(db, id, 'totalConsume');
    const newBalance = centsToYuan(newBalanceCents);
    const newTotalConsume = centsToYuan(newTotalConsumeCents);

    this.memberCardLogRepo.create(db, {
      cardId: id,
      type: MemberCardLogType.CONSUME,
      amount: -amountCents,
      balanceAfter: newBalanceCents,
      chargeId: chargeId || undefined,
      remark: remark || undefined,
      clinicId: clinicId || undefined,
    }, now);

    this.logAudit(
      db,
      AuditLogType.MEMBER_CARD_CONSUME,
      id,
      "MemberCard",
      {
        beforeData: { balance: centsToYuan(Number(card.balance) || 0) },
        afterData: { balance: newBalance },
      },
    );

    return { id, patientId: card.patientId, balance: newBalance, totalConsume: newTotalConsume };
  }

  async refund(id: string, amount: number, chargeId?: string, remark?: string, requestId?: string) {
    this.validatePositiveAmount(amount, "充值/消费/退款金额必须为有效正数");
    const amountCents = yuanToCents(amount);
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();

    const doRefund = (db: IDatabase) => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      const card = db.prepare(`SELECT id, patientId, status, balance FROM MemberCard WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as MemberCardRow & { patientId: string };
      this.assertCardExists(card);
      const result = db.prepare(
        `UPDATE MemberCard SET balance = balance + ?, totalConsume = MAX(0, totalConsume - ?), updatedAt = ? WHERE id = ? AND status = ?${clinicClause}`
      ).run(amountCents, amountCents, now, id, MemberCardStatus.ACTIVE, ...clinicParams);
      if (result.changes === 0) {
        const currentCard = db.prepare(`SELECT status FROM MemberCard WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as MemberCardRow | undefined;
        this.assertCardExists(currentCard);
        this.assertCardActive(currentCard, '会员卡已禁用，无法退款');
        throw new BusinessValidationException('退款失败');
      }
      const newBalanceCents = this.getCardField(db, id, 'balance');
      const newTotalConsumeCents = this.getCardField(db, id, 'totalConsume');
      const newBalance = centsToYuan(newBalanceCents);
      const newTotalConsume = centsToYuan(newTotalConsumeCents);

      this.memberCardLogRepo.create(db, {
        cardId: id,
        type: MemberCardLogType.REFUND,
        amount: amountCents,
        balanceAfter: newBalanceCents,
        chargeId: chargeId || undefined,
        remark: remark || undefined,
        clinicId: clinicId || undefined,
      }, now);

      this.logAudit(
        db,
        AuditLogType.MEMBER_CARD_REFUND,
        id,
        "MemberCard",
        {
          beforeData: { balance: centsToYuan(Number(card.balance) || 0) },
          afterData: { balance: newBalance },
        },
      );

      return { id, patientId: card.patientId, balance: newBalance, totalConsume: newTotalConsume };
    };

    const idempotencyKey = requestId ? `member-card-refund:${id}:${requestId}` : null;
    const result = this.executeWithIdempotency(idempotencyKey, AuditLogType.MEMBER_CARD_REFUND, doRefund);

    // 退款导致余额增加，对统计缓存的影响与充值一致
    this.eventBus.emit(new MemberCardRechargedEvent(id, result.patientId, amount, result.balance, clinicId));

    return result;
  }

  async getLogs(cardId: string, page = 1, pageSize = 100) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const logs = this.memberCardLogRepo.findByCardId(this.dbService, cardId, {
      page,
      pageSize,
      clinicClause,
      clinicParams,
    });
    logs.forEach(log => {
      log.amount = centsToYuan(Number(log.amount));
      log.balanceAfter = centsToYuan(Number(log.balanceAfter));
    });
    return logs;
  }
}
