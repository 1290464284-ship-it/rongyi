import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import * as crypto from "crypto";
import { moneyGreaterThanOrEqual, roundMoney } from "../../../common/utils/money.utils";

export interface MemberCard {
  id: string;
  patientId: string;
  cardNo: string;
  balance: number;
  totalRecharge: number;
  totalConsume: number;
  points: number;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface CreateMemberCardDto {
  patientId: string;
}

@Injectable()
export class MemberCardsService extends BaseService<MemberCard> {
  constructor(dbService: DbService) {
    super(dbService, "MemberCard", [], [], [], true, ["cardNo"]);
  }

  async create(dto: CreateMemberCardDto) {
    return this.dbService.transaction((db) => {
      const existing = db.prepare("SELECT id FROM MemberCard WHERE patientId = ?").get(dto.patientId);
      if (existing) throw new BadRequestException("该患者已有会员卡");
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const cardNo = "MC" + Date.now();
      db.prepare("INSERT INTO MemberCard (id, patientId, cardNo, balance, totalRecharge, totalConsume, status, createdAt, updatedAt) VALUES (?,?,?,0,0,0,'ACTIVE',?,?)")
        .run(id, dto.patientId, cardNo, now, now);
      return super.findOne(id);
    });
  }

  async recharge(id: string, amount: number) {
    if (!amount || amount <= 0) throw new BadRequestException("充值金额必须大于0");
    const now = new Date().toISOString();
    return this.dbService.transaction((db) => {
      const card = db.prepare("SELECT * FROM MemberCard WHERE id = ?").get(id) as Record<string, unknown>;
      if (!card) throw new NotFoundException('会员卡不存在');
      // P1 修复（充值不检查状态）：仅 ACTIVE 状态的卡可充值
      const result = db.prepare("UPDATE MemberCard SET balance = balance + ?, totalRecharge = totalRecharge + ?, updatedAt = ? WHERE id = ? AND status = 'ACTIVE'")
        .run(amount, amount, now, id);
      if (result.changes === 0) {
        const currentCard = db.prepare("SELECT status FROM MemberCard WHERE id = ?").get(id) as Record<string, unknown> | undefined;
        if (!currentCard) throw new NotFoundException('会员卡不存在');
        if (currentCard.status !== 'ACTIVE') throw new BadRequestException('会员卡已禁用，无法充值');
        throw new Error("充值失败：更新余额失败");
      }
      const updatedCard = db.prepare("SELECT balance, totalRecharge FROM MemberCard WHERE id = ?").get(id) as Record<string, unknown>;
      const newBalance = Number(updatedCard.balance) || 0;
      const newTotal = Number(updatedCard.totalRecharge) || 0;
      db.prepare("INSERT INTO MemberCardLog (id, cardId, type, amount, balanceAfter, createdAt) VALUES (?,?,?,?,?,?)")
        .run(crypto.randomUUID(), id, "RECHARGE", amount, newBalance, now);
      return { id, balance: newBalance, totalRecharge: newTotal };
    });
  }

  async findByPatient(patientId: string) {
    return this.dbService.prepare("SELECT * FROM MemberCard WHERE patientId = ?").get(patientId);
  }

  async getLogs(cardId: string) {
    return this.dbService.prepare("SELECT * FROM MemberCardLog WHERE cardId = ? ORDER BY createdAt DESC").all(cardId);
  }

  async createForPatient(patientId: string) {
    return this.create({ patientId });
  }

  async findPointLogs(cardId: string) {
    return this.dbService.prepare("SELECT * FROM MemberPointLog WHERE cardId = ? ORDER BY createdAt DESC").all(cardId);
  }

  async addPoints(id: string, points: number, chargeId?: string, remark?: string) {
    const now = new Date().toISOString();
    const logId = crypto.randomUUID();
    return this.dbService.transaction((db) => {
      const card = db.prepare("SELECT * FROM MemberCard WHERE id = ?").get(id) as Record<string, unknown> | undefined;
      if (!card) throw new NotFoundException('会员卡不存在');
      const result = db.prepare("UPDATE MemberCard SET points = points + ?, updatedAt = ? WHERE id = ?").run(points, now, id);
      if (result.changes === 0) throw new BadRequestException('积分更新失败');
      const updatedCard = db.prepare("SELECT points FROM MemberCard WHERE id = ?").get(id) as Record<string, unknown>;
      const newPoints = Number(updatedCard.points) || 0;
      db.prepare("INSERT INTO MemberPointLog (id, cardId, type, points, balanceAfter, chargeId, remark) VALUES (?,?,?,?,?,?,?)")
        .run(logId, id, 'ADD', points, newPoints, chargeId || null, remark || null);
      return { id, points: newPoints };
    });
  }

  async deductPoints(id: string, points: number, remark?: string) {
    const now = new Date().toISOString();
    const logId = crypto.randomUUID();
    return this.dbService.transaction((db) => {
      const card = db.prepare("SELECT * FROM MemberCard WHERE id = ?").get(id) as Record<string, unknown> | undefined;
      if (!card) throw new NotFoundException('会员卡不存在');
      const result = db.prepare("UPDATE MemberCard SET points = points - ?, updatedAt = ? WHERE id = ? AND points >= ?").run(points, now, id, points);
      if (result.changes === 0) throw new BadRequestException('积分不足');
      const updatedCard = db.prepare("SELECT points FROM MemberCard WHERE id = ?").get(id) as Record<string, unknown>;
      const newPoints = Number(updatedCard.points) || 0;
      db.prepare("INSERT INTO MemberPointLog (id, cardId, type, points, balanceAfter, remark) VALUES (?,?,?,?,?,?)")
        .run(logId, id, 'DEDUCT', -points, newPoints, remark || null);
      return { id, points: newPoints };
    });
  }

  async consume(id: string, amount: number, chargeId?: string, remark?: string) {
    if (!amount || amount <= 0) throw new BadRequestException("消费金额必须大于0");
    const now = new Date().toISOString();
    const logId = crypto.randomUUID();
    return this.dbService.transaction((db) => {
      const card = db.prepare("SELECT id, status, balance FROM MemberCard WHERE id = ?").get(id) as Record<string, unknown>;
      if (!card) throw new NotFoundException('会员卡不存在');
      if (card.status !== 'ACTIVE') throw new BadRequestException('会员卡状态异常，无法消费');
      const result = db.prepare(
        "UPDATE MemberCard SET balance = ROUND(balance - ?, 2), totalConsume = ROUND(totalConsume + ?, 2), updatedAt = ? WHERE id = ? AND status = 'ACTIVE' AND ROUND(balance, 2) >= ?"
      ).run(amount, amount, now, id, amount);
      if (result.changes === 0) {
        const currentCard = db.prepare("SELECT balance, status FROM MemberCard WHERE id = ?").get(id) as Record<string, unknown>;
        if (!currentCard || currentCard.status !== 'ACTIVE') throw new BadRequestException('会员卡状态异常');
        throw new BadRequestException('余额不足');
      }
      const updatedCard = db.prepare("SELECT balance, totalConsume FROM MemberCard WHERE id = ?").get(id) as Record<string, unknown>;
      const newBalance = Number(updatedCard.balance) || 0;
      const newTotalConsume = Number(updatedCard.totalConsume) || 0;
      db.prepare("INSERT INTO MemberCardLog (id, cardId, type, amount, balanceAfter, chargeId, remark, createdAt) VALUES (?,?,?,?,?,?,?,?)")
        .run(logId, id, "CONSUME", -amount, newBalance, chargeId || null, remark || null, now);
      return { id, balance: newBalance, totalConsume: newTotalConsume };
    });
  }

  async refund(id: string, amount: number, chargeId?: string, remark?: string) {
    if (!amount || amount <= 0) throw new BadRequestException("退款金额必须大于0");
    const now = new Date().toISOString();
    const logId = crypto.randomUUID();
    return this.dbService.transaction((db) => {
      const card = db.prepare("SELECT * FROM MemberCard WHERE id = ?").get(id) as Record<string, unknown>;
      if (!card) throw new NotFoundException('会员卡不存在');
      // P1 修复（退款不检查状态 + totalConsume 可为负）：仅 ACTIVE 卡可退；totalConsume 用 MAX(0,...) 防负
      const result = db.prepare(
        "UPDATE MemberCard SET balance = ROUND(balance + ?, 2), totalConsume = MAX(0, ROUND(totalConsume - ?, 2)), updatedAt = ? WHERE id = ? AND status = 'ACTIVE'"
      ).run(amount, amount, now, id);
      if (result.changes === 0) {
        const currentCard = db.prepare("SELECT status FROM MemberCard WHERE id = ?").get(id) as Record<string, unknown> | undefined;
        if (!currentCard) throw new NotFoundException('会员卡不存在');
        if (currentCard.status !== 'ACTIVE') throw new BadRequestException('会员卡已禁用，无法退款');
        throw new BadRequestException('退款失败');
      }
      const updatedCard = db.prepare("SELECT balance, totalConsume FROM MemberCard WHERE id = ?").get(id) as Record<string, unknown>;
      const newBalance = Number(updatedCard.balance) || 0;
      const newTotalConsume = Number(updatedCard.totalConsume) || 0;
      db.prepare("INSERT INTO MemberCardLog (id, cardId, type, amount, balanceAfter, chargeId, remark, createdAt) VALUES (?,?,?,?,?,?,?,?)")
        .run(logId, id, "REFUND", amount, newBalance, chargeId || null, remark || null, now);
      return { id, balance: newBalance, totalConsume: newTotalConsume };
    });
  }
}
