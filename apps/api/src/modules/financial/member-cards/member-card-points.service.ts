import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { IDatabase } from "../../../db/db.interface";
import { BaseService } from "../../../common/services/base.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { IdempotencyService } from "../../../common/services/idempotency.service";
import { PointLogType, AuditLogType } from "../../../common/constants";
import { MemberPointLogRepository } from "./repositories/member-point-log.repository";
import { MemberCard, MemberCardRow } from './member-cards.service';

@Injectable()
export class MemberCardPointsService extends BaseService<MemberCard> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private idempotency: IdempotencyService,
    private readonly memberPointLogRepo: MemberPointLogRepository,
  ) {
    super(dbService, clinicContext, { tableName: "MemberCard", uniqueFields: ["cardNo"], moneyFields: ['balance', 'totalRecharge', 'totalConsume'] });
  }

  private validatePositivePoints(points: number): void {
    if (typeof points !== 'number' || !Number.isFinite(points) || points <= 0) {
      throw new BusinessValidationException("积分必须为有效正数");
    }
  }

  private getCardField(db: IDatabase, id: string, field: string): number {
    const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
    const card = db.prepare(
      `SELECT ${field} FROM MemberCard WHERE id = ? AND deletedAt IS NULL${clinicClause}`
    ).get(id, ...clinicParams) as Record<string, unknown> | undefined;
    return card ? Number(card[field]) || 0 : 0;
  }

  private assertCardExists(card: MemberCardRow | undefined): asserts card is MemberCardRow {
    if (!card) throw new BusinessNotFoundException('会员卡不存在');
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

  /**
   * 增加积分
   * P1 修复：
   *   1. 添加 requestId 幂等支持（网络重试不会重复加积分）
   *   2. 补全审计日志（原先完全缺失，积分变动无审计记录，合规性漏洞）
   *   3. SELECT 改为查询 points 字段，用于审计 beforeData
   */
  async addPoints(id: string, points: number, chargeId?: string, remark?: string, requestId?: string) {
    this.validatePositivePoints(points);
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();

    const doAddPoints = (db: IDatabase) => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      const card = db.prepare(`SELECT id, points FROM MemberCard WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as MemberCardRow | undefined;
      this.assertCardExists(card);
      const beforePoints = Number(card.points) || 0;
      const result = db.prepare(`UPDATE MemberCard SET points = points + ?, updatedAt = ? WHERE id = ?${clinicClause}`).run(points, now, id, ...clinicParams);
      if (result.changes === 0) throw new BusinessValidationException('积分更新失败');
      const newPoints = this.getCardField(db, id, 'points');

      this.memberPointLogRepo.create(db, {
        cardId: id,
        type: PointLogType.ADD,
        points,
        balanceAfter: newPoints,
        chargeId: chargeId || undefined,
        remark: remark || undefined,
        clinicId: clinicId || undefined,
      }, now);

      this.logAudit(
        db,
        AuditLogType.MEMBER_CARD_POINTS_ADD,
        id,
        "MemberCard",
        { beforeData: { points: beforePoints }, afterData: { points: newPoints } },
      );

      return { id, points: newPoints };
    };

    const idempotencyKey = requestId ? `member-card-points-add:${id}:${requestId}` : null;
    return this.executeWithIdempotency(idempotencyKey, AuditLogType.MEMBER_CARD_POINTS_ADD, doAddPoints);
  }

  /**
   * 扣减积分
   * P1 修复：
   *   1. 添加 requestId 幂等支持（网络重试不会重复扣积分）
   *   2. 补全审计日志（原先完全缺失，积分变动无审计记录，合规性漏洞）
   *   3. SELECT 改为查询 points 字段，用于审计 beforeData
   *   CAS 保护：WHERE points >= ? 防止并发扣减导致负积分
   */
  async deductPoints(id: string, points: number, remark?: string, requestId?: string) {
    this.validatePositivePoints(points);
    const now = new Date().toISOString();
    const clinicId = this.clinicContext.getClinicId();

    const doDeductPoints = (db: IDatabase) => {
      const { clause: clinicClause, params: clinicParams } = this.buildClinicClause();
      const card = db.prepare(`SELECT id, points FROM MemberCard WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(id, ...clinicParams) as MemberCardRow | undefined;
      this.assertCardExists(card);
      const beforePoints = Number(card.points) || 0;
      const result = db.prepare(`UPDATE MemberCard SET points = points - ?, updatedAt = ? WHERE id = ? AND points >= ?${clinicClause}`).run(points, now, id, points, ...clinicParams);
      if (result.changes === 0) throw new BusinessValidationException('积分不足');
      const newPoints = this.getCardField(db, id, 'points');

      this.memberPointLogRepo.create(db, {
        cardId: id,
        type: PointLogType.DEDUCT,
        points: -points,
        balanceAfter: newPoints,
        remark: remark || undefined,
        clinicId: clinicId || undefined,
      }, now);

      this.logAudit(
        db,
        AuditLogType.MEMBER_CARD_POINTS_DEDUCT,
        id,
        "MemberCard",
        { beforeData: { points: beforePoints }, afterData: { points: newPoints } },
      );

      return { id, points: newPoints };
    };

    const idempotencyKey = requestId ? `member-card-points-deduct:${id}:${requestId}` : null;
    return this.executeWithIdempotency(idempotencyKey, AuditLogType.MEMBER_CARD_POINTS_DEDUCT, doDeductPoints);
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
}
