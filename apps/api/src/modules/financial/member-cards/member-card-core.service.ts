import { BusinessNotFoundException, BusinessValidationException } from '@common/errors';
import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import * as crypto from "node:crypto";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { centsToYuan } from "../../../common/utils/format/money.utils";
import { BUSINESS_CODE_MAX_RETRIES } from "../../../config/constants";
import { MemberCardStatus, AuditLogType } from "../../../common/constants";
import { MemberCard, MemberCardRow } from './member-cards.service';

@Injectable()
export class MemberCardCoreService extends BaseService<MemberCard> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
  ) {
    super(dbService, clinicContext, { tableName: "MemberCard", uniqueFields: ["cardNo"], moneyFields: ['balance', 'totalRecharge', 'totalConsume'] });
  }

  async create(dto: { patientId: string }): Promise<MemberCard> {
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
          const patient = db.prepare(`SELECT id FROM Patient WHERE id = ? AND deletedAt IS NULL${clinicClause}`).get(dto.patientId, ...clinicParams);
          if (!patient) throw new BusinessNotFoundException("患者不存在");
          const existing = db.prepare(`SELECT id FROM MemberCard WHERE patientId = ? AND deletedAt IS NULL${clinicClause}`).get(dto.patientId, ...clinicParams);
          if (existing) throw new BusinessValidationException("该患者已有会员卡");

          db.prepare(`INSERT INTO MemberCard (id, patientId, cardNo, balance, totalRecharge, totalConsume, status, clinicId, createdAt, updatedAt) VALUES (?,?,?,0,0,0,?,?,?,?)`)
            .run(id, dto.patientId, cardNo, MemberCardStatus.ACTIVE, clinicId || undefined, now, now);

          const created = db.prepare(
            `SELECT id, patientId, cardNo, balance, totalRecharge, totalConsume, points, status, createdAt, updatedAt FROM MemberCard WHERE id = ? AND deletedAt IS NULL`
          ).get(id) as MemberCardRow;
          if (created) {
            created.balance = centsToYuan(Number(created.balance) || 0);
            created.totalRecharge = centsToYuan(Number(created.totalRecharge) || 0);
            created.totalConsume = centsToYuan(Number(created.totalConsume) || 0);
          }

          this.logAudit(db, AuditLogType.MEMBER_CARD_CREATE, id, 'MemberCard', {
            afterData: { cardNo, patientId: dto.patientId, status: MemberCardStatus.ACTIVE },
          });

          return created;
        });

        return result as MemberCard;
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

  async createForPatient(patientId: string) {
    return this.create({ patientId });
  }
}
