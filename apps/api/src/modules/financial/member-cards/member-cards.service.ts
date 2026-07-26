import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { IDatabase } from "../../../db/db.interface";
import { BaseService } from "../../../common/services/base.service";
import * as crypto from "node:crypto";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { yuanToCents, centsToYuan } from "../../../common/utils/format/money.utils";
import { BUSINESS_CODE_MAX_RETRIES } from "../../../config/constants";
import { IdempotencyService } from "../../../common/services/idempotency.service";
import { MemberCardStatus, MemberCardLogType, PointLogType, AuditLogType } from "../../../common/constants";
import { StatsService } from '../../system/stats/stats.service';
import { MemberCardLogRepository } from "./repositories/member-card-log.repository";
import { MemberPointLogRepository } from "./repositories/member-point-log.repository";

export interface MemberCard {
  id: string;
  patientId: string;
  cardNo: string;
  balance: number;
  totalRecharge: number;
  totalConsume: number;
  points: number;
  status: MemberCardStatus;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface CreateMemberCardDto {
  patientId: string;
}

export interface MemberCardRow {
  id: string;
  patientId?: string;
  cardNo?: string;
  balance?: number;
  totalRecharge?: number;
  totalConsume?: number;
  points?: number;
  status?: MemberCardStatus;
  createdAt?: string;
  updatedAt?: string;
}

@Injectable()
export class MemberCardsService extends BaseService<MemberCard> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private idempotency: IdempotencyService,
    private readonly memberCardLogRepo: MemberCardLogRepository,
    private readonly memberPointLogRepo: MemberPointLogRepository,
    private statsService: StatsService,
  ) {
    super(dbService, clinicContext, "MemberCard", [], [], [], true, ["cardNo"], undefined, undefined, ['balance', 'totalRecharge', 'totalConsume']);
  }

  private validatePositiveAmount(amount: number, message: string): void {
    if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0) {
      throw new BusinessValidationException(message);
    }
  }

  private validatePositivePoints(points: number): void {
    if (typeof points !== 'number' || !Number.isFinite(points) || points <= 0) {
      throw new BusinessValidationException("积分必须为有效正数");
    }
  }

  private getCardForUpdate(
    db: IDatabase,
    id: string,
    fields: string,
  ): MemberCardRow | undefined {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    return db.prepare(
      `SELECT ${fields} FROM MemberCard WHERE id = ?${clinicClause}`
    ).get(id, ...clinicParams) as MemberCardRow | undefined;
  }

  private getCardField(
    db: IDatabase,
    id: string,
    field: string,
  ): number {
    const card = this.getCardForUpdate(db, id, field);
    return card ? Number((card as unknown as Record<string, unknown>)[field]) || 0 : 0;
  }

  private assertCardExists(card: MemberCardRow | undefined): void {
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

  async create(dto: CreateMemberCardDto) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    const MAX_RETRIES = BUSINESS_CODE_MAX_RETRIES;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const cardNo = "MC" + Date.now() + crypto.randomBytes(2).toString('hex') + (attempt > 0 ? `-${attempt}` : "");

        const result = this.dbService.transaction((db) => {
          const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
          const existing = db.prepare(`SELECT id FROM MemberCard WHERE patientId = ?${clinicClause}`).get(dto.patientId, ...clinicParams);
          if (existing) throw new BusinessValidationException("该患者已有会员卡");

          db.prepare(`INSERT INTO MemberCard (id, patientId, cardNo, balance, totalRecharge, totalConsume, status, clinicId, createdAt, updatedAt) VALUES (?,?,?,0,0,0,?,?,?,?)`)
            .run(id, dto.patientId, cardNo, MemberCardStatus.ACTIVE, clinicId || null, now, now);

          return super.findOne(id);
        });

        return result;
      } catch (e: unknown) {
        lastError = e instanceof Error ? e : new Error(String(e));
        if (e instanceof Error && e.message.includes("UNIQUE constraint failed: MemberCard.cardNo")) {
          continue;
        }
        throw e;
      }
    }
    throw lastError || new BusinessValidationException("创建会员卡失败，请重试");
  }

  async recharge(id: string, amount: number, requestId?: string) {
    this.validatePositiveAmount(amount, "充值/消费/退款金额必须为有效正数");
    const amountCents = yuanToCents(amount);
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();

    const doRecharge = (db: IDatabase) => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      const card = db.prepare(`SELECT id, status, balance FROM MemberCard WHERE id = ?${clinicClause}`).get(id, ...clinicParams) as MemberCardRow;
      this.assertCardExists(card);
      const result = db.prepare(`UPDATE MemberCard SET balance = balance + ?, totalRecharge = totalRecharge + ?, updatedAt = ? WHERE id = ? AND status = ?${clinicClause}`)
        .run(amountCents, amountCents, now, id, MemberCardStatus.ACTIVE, ...clinicParams);
      if (result.changes === 0) {
        const currentCard = db.prepare(`SELECT status FROM MemberCard WHERE id = ?${clinicClause}`).get(id, ...clinicParams) as MemberCardRow | undefined;
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
        clinicId: clinicId || null,
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

      return { id, balance: newBalance, totalRecharge: newTotal };
    };

    const idempotencyKey = requestId ? `member-card-recharge:${id}:${requestId}` : null;
    const result = this.executeWithIdempotency(idempotencyKey, AuditLogType.MEMBER_CARD_RECHARGE, doRecharge);

    this.statsService.invalidateStatsCache('dashboard');
    this.statsService.invalidateStatsCache('member');
    this.statsService.invalidateStatsCache('revenue');

    return result;
  }

  async findByPatient(patientId: string) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const card = this.dbService.prepare(
      `SELECT id, patientId, cardNo, balance, totalRecharge, totalConsume, points, status, createdAt, updatedAt 
       FROM MemberCard 
       WHERE patientId = ? AND deletedAt IS NULL${clinicClause}`
    ).get(patientId, ...clinicParams) as MemberCardRow | undefined;
    if (card) {
      card.balance = centsToYuan(Number(card.balance));
      card.totalRecharge = centsToYuan(Number(card.totalRecharge));
      card.totalConsume = centsToYuan(Number(card.totalConsume));
    }
    return card;
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

  async createForPatient(patientId: string) {
    return this.create({ patientId });
  }

  async findPointLogs(cardId: string, page = 1, pageSize = 100) {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    return this.memberPointLogRepo.findByCardId(this.dbService, cardId, {
      page,
      pageSize,
      clinicClause,
      clinicParams,
    });
  }

  async addPoints(id: string, points: number, chargeId?: string, remark?: string) {
    this.validatePositivePoints(points);
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    return this.dbService.transaction((db) => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      const card = db.prepare(`SELECT id FROM MemberCard WHERE id = ?${clinicClause}`).get(id, ...clinicParams) as MemberCardRow | undefined;
      this.assertCardExists(card);
      const result = db.prepare(`UPDATE MemberCard SET points = points + ?, updatedAt = ? WHERE id = ?${clinicClause}`).run(points, now, id, ...clinicParams);
      if (result.changes === 0) throw new BusinessValidationException('积分更新失败');
      const newPoints = this.getCardField(db, id, 'points');

      this.memberPointLogRepo.create(db, {
        cardId: id,
        type: PointLogType.ADD,
        points,
        balanceAfter: newPoints,
        chargeId: chargeId || null,
        remark: remark || null,
        clinicId: clinicId || null,
      }, now);

      return { id, points: newPoints };
    });
  }

  async deductPoints(id: string, points: number, remark?: string) {
    this.validatePositivePoints(points);
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();
    return this.dbService.transaction((db) => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      const card = db.prepare(`SELECT id FROM MemberCard WHERE id = ?${clinicClause}`).get(id, ...clinicParams) as MemberCardRow | undefined;
      this.assertCardExists(card);
      const result = db.prepare(`UPDATE MemberCard SET points = points - ?, updatedAt = ? WHERE id = ? AND points >= ?${clinicClause}`).run(points, now, id, points, ...clinicParams);
      if (result.changes === 0) throw new BusinessValidationException('积分不足');
      const newPoints = this.getCardField(db, id, 'points');

      this.memberPointLogRepo.create(db, {
        cardId: id,
        type: PointLogType.DEDUCT,
        points: -points,
        balanceAfter: newPoints,
        remark: remark || null,
        clinicId: clinicId || null,
      }, now);

      return { id, points: newPoints };
    });
  }

  async consume(id: string, amount: number, chargeId?: string, remark?: string, requestId?: string) {
    this.validatePositiveAmount(amount, "充值/消费/退款金额必须为有效正数");
    const amountCents = yuanToCents(amount);
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();

    const doConsume = (db: IDatabase) => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      const card = db.prepare(`SELECT id, status, balance FROM MemberCard WHERE id = ?${clinicClause}`).get(id, ...clinicParams) as MemberCardRow;
      this.assertCardExists(card);
      this.assertCardActive(card, '会员卡状态异常，无法消费');
      const result = db.prepare(
        `UPDATE MemberCard SET balance = balance - ?, totalConsume = totalConsume + ?, updatedAt = ? WHERE id = ? AND status = ? AND balance >= ?${clinicClause}`
      ).run(amountCents, amountCents, now, id, MemberCardStatus.ACTIVE, amountCents, ...clinicParams);
      if (result.changes === 0) {
        const currentCard = db.prepare(`SELECT balance, status FROM MemberCard WHERE id = ?${clinicClause}`).get(id, ...clinicParams) as MemberCardRow;
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
        chargeId: chargeId || null,
        remark: remark || null,
        clinicId: clinicId || null,
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

      return { id, balance: newBalance, totalConsume: newTotalConsume };
    };

    const idempotencyKey = requestId ? `member-card-consume:${id}:${requestId}` : null;
    const result = this.executeWithIdempotency(idempotencyKey, AuditLogType.MEMBER_CARD_CONSUME, doConsume);

    this.statsService.invalidateStatsCache('dashboard');
    this.statsService.invalidateStatsCache('member');
    this.statsService.invalidateStatsCache('revenue');

    return result;
  }

  async refund(id: string, amount: number, chargeId?: string, remark?: string, requestId?: string) {
    this.validatePositiveAmount(amount, "充值/消费/退款金额必须为有效正数");
    const amountCents = yuanToCents(amount);
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();

    const doRefund = (db: IDatabase) => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      const card = db.prepare(`SELECT id, status, balance FROM MemberCard WHERE id = ?${clinicClause}`).get(id, ...clinicParams) as MemberCardRow;
      this.assertCardExists(card);
      const result = db.prepare(
        `UPDATE MemberCard SET balance = balance + ?, totalConsume = MAX(0, totalConsume - ?), updatedAt = ? WHERE id = ? AND status = ?${clinicClause}`
      ).run(amountCents, amountCents, now, id, MemberCardStatus.ACTIVE, ...clinicParams);
      if (result.changes === 0) {
        const currentCard = db.prepare(`SELECT status FROM MemberCard WHERE id = ?${clinicClause}`).get(id, ...clinicParams) as MemberCardRow | undefined;
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
        chargeId: chargeId || null,
        remark: remark || null,
        clinicId: clinicId || null,
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

      return { id, balance: newBalance, totalConsume: newTotalConsume };
    };

    const idempotencyKey = requestId ? `member-card-refund:${id}:${requestId}` : null;
    const result = this.executeWithIdempotency(idempotencyKey, AuditLogType.MEMBER_CARD_REFUND, doRefund);

    this.statsService.invalidateStatsCache('dashboard');
    this.statsService.invalidateStatsCache('member');
    this.statsService.invalidateStatsCache('revenue');

    return result;
  }
}
