import { Injectable } from '@nestjs/common';

import { DbService } from "../../../db/db.service";
import { IDatabase } from "../../../db/db.interface";
import { BaseService } from "../../../common/services/base.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { MemberCardStatus } from "../../../common/constants";
import { MemberCardCoreService } from './member-card-core.service';
import { MemberCardBalanceService } from './member-card-balance.service';
import { MemberCardPointsService } from './member-card-points.service';

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
  deletedAt?: string;
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

/**
 * MemberCardsService — Facade 模式
 * 委托 core / balance / points 三个子服务实现具体业务，
 * 保持对外 API 签名不变，降低单文件认知负担。
 */
@Injectable()
export class MemberCardsService extends BaseService<MemberCard> {
  constructor(
    dbService: DbService,
    clinicContext: ClinicContextService,
    private readonly core: MemberCardCoreService,
    private readonly balance: MemberCardBalanceService,
    private readonly points: MemberCardPointsService,
  ) {
    super(dbService, clinicContext, { tableName: "MemberCard", uniqueFields: ["cardNo"], moneyFields: ['balance', 'totalRecharge', 'totalConsume'] });
  }

  // ─── Core ───────────────────────────────────────────────────

  async create(dto: CreateMemberCardDto): Promise<MemberCard> {
    return this.core.create(dto);
  }

  async findByPatient(patientId: string) {
    return this.core.findByPatient(patientId);
  }

  async createForPatient(patientId: string) {
    return this.core.createForPatient(patientId);
  }

  // ─── Balance ────────────────────────────────────────────────

  async recharge(id: string, amount: number, requestId?: string) {
    return this.balance.recharge(id, amount, requestId);
  }

  async consume(id: string, amount: number, chargeId?: string, remark?: string, requestId?: string) {
    return this.balance.consume(id, amount, chargeId, remark, requestId);
  }

  consumeSync(db: IDatabase, id: string, amount: number, chargeId?: string, remark?: string) {
    return this.balance.consumeSync(db, id, amount, chargeId, remark);
  }

  async refund(id: string, amount: number, chargeId?: string, remark?: string, requestId?: string) {
    return this.balance.refund(id, amount, chargeId, remark, requestId);
  }

  async getLogs(cardId: string, page = 1, pageSize = 100) {
    return this.balance.getLogs(cardId, page, pageSize);
  }

  // ─── Points ─────────────────────────────────────────────────

  async addPoints(id: string, points: number, chargeId?: string, remark?: string, requestId?: string) {
    return this.points.addPoints(id, points, chargeId, remark, requestId);
  }

  async deductPoints(id: string, points: number, remark?: string, requestId?: string) {
    return this.points.deductPoints(id, points, remark, requestId);
  }

  async findPointLogs(cardId: string, page = 1, pageSize = 100) {
    return this.points.findPointLogs(cardId, page, pageSize);
  }
}
