import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import * as crypto from "crypto";
import { UpdateBuilder } from "../../../common/utils/sql-builder";
import { multiplyMoney, sumMoney, roundMoney, moneyGreaterThan, moneyGreaterThanOrEqual, moneyLessThanOrEqual } from "../../../common/utils/money.utils";

export interface ChargeItemDto {
  name: string;
  category?: string;
  price?: number;
  quantity?: number;
  teethNumbers?: string[];
  /** P0.6: 关联治疗项目 ID（用于核验收费是否对应实际治疗） */
  treatmentId?: string;
  /** P0.7: 关联库存项目 ID（材料费扣库存） */
  inventoryItemId?: string;
  /** P0.7: 该项消耗的库存数量（默认等于 quantity） */
  consumedQuantity?: number;
}

export interface CreateChargeDto {
  patientId: string;
  doctorId?: string;
  visitId?: string;
  remark?: string;
  items: ChargeItemDto[];
  requestId?: string;
}

export interface ListChargeParams {
  page?: number | string;
  pageSize?: number | string;
}

export interface PayChargeDto {
  amount: number;
  payMethod?: string;
  /** P0.3: 会员卡支付时必填，扣减会员卡余额 */
  memberCardId?: string;
  requestId?: string;
}

export interface ChargeComboDto {
  name?: string;
  category?: string;
  isPublic?: number | boolean;
}

export interface PaymentMethodDto {
  name?: string;
  code?: string;
  isEnabled?: number | boolean;
}

export interface ListDebtParams {
  page?: number | string;
  pageSize?: number | string;
}

export interface CreateDebtDto {
  chargeId?: string;
  patientId?: string;
  totalAmount?: number;
  debtAmount?: number;
}

export interface PayDebtDto {
  amount: number;
  payMethod?: string;
}

export interface ChargeRecord {
  id: string;
  patientId: string;
  doctorId?: string;
  visitId?: string | null;
  number: string;
  totalAmount: number;
  paidAmount: number;
  discount: number;
  status: string;
  remark?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
}

export interface ChargeItemRecord {
  id: string;
  chargeId: string;
  treatmentId?: string | null;
  inventoryItemId?: string | null;
  consumedQuantity?: number;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers?: string;
  subtotal: number;
}

export interface DebtRecord {
  id: string;
  chargeId?: string;
  patientId?: string;
  totalAmount: number;
  paidAmount: number;
  debtAmount: number;
  status: string;
  lastPaymentAt?: string;
  remark?: string;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ChargeV2Service {
  constructor(private dbService: DbService) {}

  // ==================== 基础收费 CRUD ====================

  /**
   * P0.6/P0.7 修复：
   *   - ChargeItem.treatmentId 在创建时即写入（关联治疗项目）
   *   - ChargeItem.inventoryItemId + consumedQuantity 在创建时即写入，并立即扣减 InventoryItem.stock
   *   - 同时写入 InventoryTransaction 流水（type=OUT，单价取 ChargeItem.price）
   *   - NaN 防御：Number('abc')=NaN 不能流入 totalAmount
   */
  async createCharge(dto: CreateChargeDto) {
    if (!dto.items || dto.items.length === 0) throw new BadRequestException("收费明细不能为空");
    // NaN 防御：price/quantity 必须是有限正数（NaN >= 0 为 false，但 NaN || 0 = 0 会掩盖问题）
    for (const item of dto.items) {
      const price = Number(item.price);
      const qty = Number(item.quantity || 1);
      if (!Number.isFinite(price) || price < 0) throw new BadRequestException(`收费项 "${item.name}" 价格无效`);
      if (!Number.isFinite(qty) || qty < 1) throw new BadRequestException(`收费项 "${item.name}" 数量无效`);
    }

    const idempotencyKey = dto.requestId ? `create_charge:${dto.requestId}` : null;

    const createHandler = (db: any) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      const totalAmount = sumMoney(dto.items.map(i => multiplyMoney(Number(i.price || 0), Number(i.quantity || 1))));
      db.prepare(
        "INSERT INTO Charge (id, patientId, doctorId, visitId, number, totalAmount, paidAmount, discount, status, remark, createdAt, updatedAt) VALUES (?,?,?,?,?,0,0,'UNPAID',?,?,?)"
      ).run(id, dto.patientId, dto.doctorId || null, dto.visitId || null, `R${Date.now()}-${crypto.randomBytes(4).toString('hex')}`, totalAmount, dto.remark || null, now, now);

      // P0.6/P0.7: ChargeItem 写入 treatmentId + inventoryItemId + consumedQuantity
      for (const item of dto.items) {
        const subtotal = multiplyMoney(Number(item.price || 0), Number(item.quantity || 1));
        const itemId = crypto.randomUUID();
        const consumedQty = Number(item.consumedQuantity ?? item.quantity ?? 1);
        db.prepare(
          "INSERT INTO ChargeItem (id, chargeId, treatmentId, inventoryItemId, consumedQuantity, name, category, price, quantity, teethNumbers, subtotal) VALUES (?,?,?,?,?,?,?,?,?,?,?)"
        ).run(
          itemId, id,
          item.treatmentId || null,
          item.inventoryItemId || null,
          item.inventoryItemId ? consumedQty : 0,
          item.name, item.category || '',
          Number(item.price || 0), Number(item.quantity || 1),
          JSON.stringify(item.teethNumbers || []),
          subtotal,
        );

        // P0.7: 扣减库存并写流水（材料费与库存关联）
        if (item.inventoryItemId) {
          const deductResult = db.prepare(
            "UPDATE InventoryItem SET stock = stock - ?, updatedAt = ? WHERE id = ? AND stock >= ?"
          ).run(consumedQty, now, item.inventoryItemId, consumedQty);
          if (deductResult.changes === 0) {
            const inv = db.prepare("SELECT name, stock FROM InventoryItem WHERE id = ?").get(item.inventoryItemId) as { name: string; stock: number } | undefined;
            throw new BadRequestException(
              inv ? `库存不足：${inv.name}（当前 ${inv.stock}，需 ${consumedQty}）` : `库存项目不存在: ${item.inventoryItemId}`
            );
          }
          db.prepare(
            "INSERT INTO InventoryTransaction (id, itemId, type, quantity, unitPrice, totalAmount, operatorId, remark, createdAt) VALUES (?, ?, 'OUT', ?, ?, ?, ?, ?, ?)"
          ).run(
            crypto.randomUUID(), item.inventoryItemId, consumedQty,
            Number(item.price || 0), multiplyMoney(Number(item.price || 0), consumedQty),
            dto.doctorId || null, `收费单 ${id} 扣减`, now,
          );
        }
      }
      return db.prepare("SELECT id, patientId, doctorId, visitId, number, totalAmount, paidAmount, discount, status, remark, createdAt, updatedAt FROM Charge WHERE id = ?").get(id) as ChargeRecord;
    };

    if (idempotencyKey) {
      return this.dbService.transaction((db) => {
        const now = new Date().toISOString();
        const existing = db.prepare(
          "SELECT id, key, status, result, expiresAt FROM IdempotencyRecord WHERE key = ? AND expiresAt > ?"
        ).get(idempotencyKey, now) as Record<string, unknown> | undefined;

        if (existing) {
          if (existing.status === 'COMPLETED' && existing.result) {
            return JSON.parse(existing.result as string);
          }
          if (existing.status === 'PROCESSING') {
            throw new BadRequestException("收费单创建中，请稍后再试");
          }
        }

        const recordId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        try {
          db.prepare(
            "INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, 'CREATE_CHARGE', 'PROCESSING', ?, ?)"
          ).run(recordId, idempotencyKey, now, expiresAt);
        } catch (e: unknown) {
          if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
            const retryExisting = db.prepare(
              "SELECT id, key, status, result FROM IdempotencyRecord WHERE key = ?"
            ).get(idempotencyKey) as Record<string, unknown> | undefined;
            if (retryExisting?.status === 'COMPLETED' && retryExisting.result) {
              return JSON.parse(retryExisting.result as string);
            }
            throw new BadRequestException("收费单创建中，请稍后再试");
          }
          throw e;
        }

        try {
          const result = createHandler(db);
          db.prepare(
            "UPDATE IdempotencyRecord SET status = 'COMPLETED', result = ? WHERE id = ?"
          ).run(JSON.stringify(result), recordId);
          return result;
        } catch (e) {
          db.prepare(
            "UPDATE IdempotencyRecord SET status = 'FAILED', result = ? WHERE id = ?"
          ).run(JSON.stringify({ error: (e as Error).message }), recordId);
          throw e;
        }
      });
    }

    return this.dbService.transaction(createHandler);
  }

  async listCharges(params?: ListChargeParams) {
    const p = params || {};
    const page = Math.max(1, Number(p.page) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(p.pageSize) || 20));
    const items = this.dbService.prepare("SELECT id, patientId, doctorId, visitId, number, totalAmount, paidAmount, discount, status, remark, createdAt, updatedAt FROM Charge WHERE deletedAt IS NULL ORDER BY createdAt DESC LIMIT ? OFFSET ?").all(pageSize, (page - 1) * pageSize) as ChargeRecord[];
    const total = (this.dbService.prepare("SELECT COUNT(*) as count FROM Charge WHERE deletedAt IS NULL").get() as { count: number }).count;

    if (items.length > 0) {
      const chargeIds = items.map(c => c.id);
      const placeholders = chargeIds.map(() => '?').join(',');
      const chargeItems = this.dbService.prepare(`SELECT id, chargeId, treatmentId, inventoryItemId, consumedQuantity, name, category, price, quantity, teethNumbers, subtotal FROM ChargeItem WHERE chargeId IN (${placeholders}) AND deletedAt IS NULL`).all(...chargeIds) as ChargeItemRecord[];
      const itemsByChargeId = new Map<string, ChargeItemRecord[]>();
      for (const item of chargeItems) {
        const arr = itemsByChargeId.get(item.chargeId) || [];
        arr.push(item);
        itemsByChargeId.set(item.chargeId, arr);
      }
      const itemsWithDetails = items.map(charge => ({
        ...charge,
        items: itemsByChargeId.get(charge.id) || [],
      }));
      return { items: itemsWithDetails, total, page, pageSize };
    }

    return { items, total, page, pageSize };
  }

  async getCharge(id: string) {
    const charge = this.dbService.prepare("SELECT id, patientId, doctorId, visitId, number, totalAmount, paidAmount, discount, status, remark, createdAt, updatedAt FROM Charge WHERE id = ? AND deletedAt IS NULL").get(id) as ChargeRecord | undefined;
    if (!charge) throw new NotFoundException("收费单不存在");
    const items = this.dbService.prepare("SELECT id, chargeId, treatmentId, inventoryItemId, consumedQuantity, name, category, price, quantity, teethNumbers, subtotal FROM ChargeItem WHERE chargeId = ? AND deletedAt IS NULL").all(id) as ChargeItemRecord[];
    return { ...charge, items };
  }

  /**
   * P0.3 修复：支付与会员卡消费必须事务关联
   *   - 幂等记录 INSERT/UPDATE 全部移入 dbService.transaction 内（原代码崩溃后永久 PROCESSING）
   *   - 若 payMethod === 'MEMBER_CARD'，必须在同一事务内调用 MemberCard 扣款逻辑
   *     避免出现"已付款未扣卡"或"已扣卡未付款"的财务漏洞
   *   - 写入 AuditLog 审计日志
   *   - NaN 防御
   */
  async payCharge(id: string, dto: PayChargeDto, _userId?: string) {
    // NaN 防御
    if (typeof dto.amount !== "number" || !Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException("支付金额必须为有效正数");
    }
    const amount = Number(dto.amount);
    const now = new Date().toISOString();
    const payMethod = dto.payMethod || 'OTHER';
    const idempotencyKey = dto.requestId ? `pay:${id}:${dto.requestId}` : null;

    // 会员卡支付前置校验
    if (payMethod === 'MEMBER_CARD') {
      if (!dto.memberCardId) throw new BadRequestException("会员卡支付必须提供 memberCardId");
    }

    const payHandler = (db: any): ChargeRecord => {
      // 幂等记录 INSERT（同事务）
      let idempRecordId: string | null = null;
      if (idempotencyKey) {
        const existing = db.prepare(
          "SELECT id, key, status, result, expiresAt FROM IdempotencyRecord WHERE key = ? AND expiresAt > ?"
        ).get(idempotencyKey, now) as Record<string, unknown> | undefined;
        if (existing) {
          if (existing.status === 'COMPLETED' && existing.result) {
            return JSON.parse(existing.result as string);
          }
          if (existing.status === 'PROCESSING') {
            throw new BadRequestException("支付处理中，请稍后再试");
          }
          // FAILED 状态：清理旧记录，允许重试（修复 IdempotencyService 的 FAILED 24h 阻塞问题）
          db.prepare("DELETE FROM IdempotencyRecord WHERE id = ?").run(existing.id);
        }

        idempRecordId = crypto.randomUUID();
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        try {
          db.prepare(
            "INSERT INTO IdempotencyRecord (id, key, type, status, createdAt, expiresAt) VALUES (?, ?, 'PAY_CHARGE', 'PROCESSING', ?, ?)"
          ).run(idempRecordId, idempotencyKey, now, expiresAt);
        } catch (e: unknown) {
          if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
            const retryExisting = db.prepare(
              "SELECT id, key, status, result FROM IdempotencyRecord WHERE key = ?"
            ).get(idempotencyKey) as Record<string, unknown> | undefined;
            if (retryExisting?.status === 'COMPLETED' && retryExisting.result) {
              return JSON.parse(retryExisting.result as string);
            }
            throw new BadRequestException("支付处理中，请稍后再试");
          }
          throw e;
        }
      }

      try {
        // P0.3: 会员卡扣款必须在 Charge 更新之前，且在同一事务内
        // 这样如果余额不足或卡状态异常，Charge 不会被更新，整个事务回滚
        let memberCardConsumeResult: { cardId: string; balanceAfter: number } | null = null;
        if (payMethod === 'MEMBER_CARD') {
          memberCardConsumeResult = this.consumeMemberCardInTx(db, {
            cardId: dto.memberCardId!,
            amount,
            chargeId: id,
            now,
          });
        }

        const chargeBefore = db.prepare("SELECT id, status, totalAmount, paidAmount, payMethod FROM Charge WHERE id = ?").get(id) as Record<string, unknown> | undefined;

        const updateResult = db.prepare(
          "UPDATE Charge SET paidAmount = ROUND(paidAmount + ?, 2), status = CASE WHEN ROUND(paidAmount + ?, 2) >= ROUND(totalAmount, 2) THEN 'PAID' WHEN ROUND(paidAmount + ?, 2) > 0 THEN 'PARTIAL' ELSE 'UNPAID' END, payMethod = ?, paidAt = CASE WHEN ROUND(paidAmount + ?, 2) >= ROUND(totalAmount, 2) THEN ? ELSE COALESCE(paidAt, ?) END, updatedAt = ? WHERE id = ? AND status != 'PAID' AND ROUND(paidAmount + ?, 2) <= ROUND(totalAmount, 2)"
        ).run(amount, amount, amount, payMethod, amount, now, now, now, id, amount);

        if (updateResult.changes === 0) {
          const charge = db.prepare("SELECT id, status, totalAmount, paidAmount FROM Charge WHERE id = ?").get(id) as Record<string, unknown>;
          if (!charge) throw new NotFoundException("收费单不存在");
          if (charge.status === 'PAID') throw new BadRequestException("该收费已完成，不可重复支付");
          throw new BadRequestException("支付金额超出应收金额");
        }

        const result = db.prepare("SELECT id, patientId, doctorId, visitId, number, totalAmount, paidAmount, discount, status, remark, createdAt, updatedAt FROM Charge WHERE id = ?").get(id) as ChargeRecord;

        // 写入 AuditLog
        db.prepare(
          "INSERT INTO AuditLog (id, type, targetId, targetType, operatorId, amount, beforeData, afterData, remark, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
        ).run(
          crypto.randomUUID(),
          "PAY_CHARGE",
          id,
          "Charge",
          _userId || null,
          amount,
          JSON.stringify(chargeBefore),
          JSON.stringify({ paidAmount: result.paidAmount, status: result.status, payMethod, memberCard: memberCardConsumeResult }),
          payMethod === 'MEMBER_CARD' ? `会员卡支付 ${amount}` : `支付 ${amount} (${payMethod})`,
          now,
        );

        // 幂等记录 UPDATE 为 COMPLETED（同事务）
        if (idempRecordId) {
          db.prepare(
            "UPDATE IdempotencyRecord SET status = 'COMPLETED', result = ? WHERE id = ?"
          ).run(JSON.stringify(result), idempRecordId);
        }

        return result;
      } catch (e) {
        // 幂等记录 UPDATE 为 FAILED（同事务，整事务会回滚但 FAILED 标记仍然写入，下次可重试）
        if (idempRecordId) {
          db.prepare(
            "UPDATE IdempotencyRecord SET status = 'FAILED', result = ? WHERE id = ?"
          ).run(JSON.stringify({ error: (e as Error).message }), idempRecordId);
        }
        throw e;
      }
    };

    return this.dbService.transaction((db) => payHandler(db));
  }

  /**
   * P0.3: 会员卡扣款（同事务内执行）
   * 失败时整个外层事务回滚，避免"已付款未扣卡"
   */
  private consumeMemberCardInTx(
    db: any,
    params: { cardId: string; amount: number; chargeId: string; now: string },
  ): { cardId: string; balanceAfter: number } {
    const { cardId, amount, chargeId, now } = params;
    const card = db.prepare("SELECT id, status, balance FROM MemberCard WHERE id = ?").get(cardId) as { id: string; status: string; balance: number } | undefined;
    if (!card) throw new BadRequestException("会员卡不存在");
    if (card.status !== 'ACTIVE') throw new BadRequestException("会员卡状态异常，无法消费");

    const result = db.prepare(
      "UPDATE MemberCard SET balance = ROUND(balance - ?, 2), totalConsume = ROUND(totalConsume + ?, 2), updatedAt = ? WHERE id = ? AND status = 'ACTIVE' AND ROUND(balance, 2) >= ?"
    ).run(amount, amount, now, cardId, amount);
    if (result.changes === 0) {
      throw new BadRequestException(`会员卡余额不足（当前 ${card.balance}，需 ${amount}）`);
    }
    const updatedCard = db.prepare("SELECT balance FROM MemberCard WHERE id = ?").get(cardId) as { balance: number };
    const balanceAfter = Number(updatedCard.balance) || 0;
    db.prepare(
      "INSERT INTO MemberCardLog (id, cardId, type, amount, balanceAfter, chargeId, remark, createdAt) VALUES (?, ?, 'CONSUME', ?, ?, ?, ?, ?)"
    ).run(crypto.randomUUID(), cardId, -amount, balanceAfter, chargeId, "收费支付", now);
    return { cardId, balanceAfter };
  }

  // ==================== 收费组合 ====================

  async listCombos(_userId?: string) {
    const pageSize = 100;
    const items = this.dbService.prepare("SELECT id, name, category, isPublic, creatorId, createdAt FROM ChargeCombo WHERE deletedAt IS NULL ORDER BY createdAt DESC LIMIT ?").all(pageSize);
    return { items, total: items.length, page: 1, pageSize };
  }

  async createCombo(dto: ChargeComboDto, _userId?: string) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.prepare(
      "INSERT INTO ChargeCombo (id, name, category, isPublic, creatorId, createdAt) VALUES (?,?,?,?,?,?)"
    ).run(id, dto.name || '', dto.category || null, 1, _userId || null, now);
    return { id };
  }

  async updateCombo(id: string, dto: ChargeComboDto) {
    const builder = new UpdateBuilder("ChargeCombo");
    builder.set("name", dto.name);
    builder.set("category", dto.category);
    builder.set("isPublic", dto.isPublic !== undefined ? (dto.isPublic ? 1 : 0) : undefined);
    const result = builder.build(id);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    return { id };
  }

  async deleteCombo(id: string) {
    this.dbService.prepare("DELETE FROM ChargeCombo WHERE id = ?").run(id);
    return { id };
  }

  // ==================== 缴费方式 ====================

  async listPaymentMethods() {
    const pageSize = 100;
    const items = this.dbService.prepare("SELECT id, name, code, isEnabled, createdAt FROM PaymentMethod WHERE deletedAt IS NULL ORDER BY createdAt DESC LIMIT ?").all(pageSize);
    return { items, total: items.length, page: 1, pageSize };
  }

  async createPaymentMethod(dto: PaymentMethodDto) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.prepare(
      "INSERT INTO PaymentMethod (id, name, code, isEnabled, createdAt) VALUES (?,?,?,?,?)"
    ).run(id, dto.name || '', dto.code || dto.name || id, 1, now);
    return { id };
  }

  async updatePaymentMethod(id: string, dto: PaymentMethodDto) {
    const builder = new UpdateBuilder("PaymentMethod");
    builder.set("name", dto.name);
    builder.set("isEnabled", dto.isEnabled);
    const result = builder.build(id);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    return { id };
  }

  async deletePaymentMethod(id: string) {
    this.dbService.prepare("DELETE FROM PaymentMethod WHERE id = ?").run(id);
    return { id };
  }

  async togglePaymentMethod(id: string) {
    this.dbService.prepare("UPDATE PaymentMethod SET isEnabled = CASE WHEN isEnabled = 1 THEN 0 ELSE 1 END WHERE id = ?").run(id);
    return { id };
  }

  // ==================== 欠费管理 ====================

  async listDebts(dto?: ListDebtParams) {
    const pageSize = 100;
    const d = dto || {};
    const page = Number(d.page) || 1;
    const pSize = Math.min(Number(d.pageSize) || pageSize, 200);
    const [items, total] = await Promise.resolve([
      this.dbService.prepare("SELECT id, chargeId, patientId, totalAmount, paidAmount, debtAmount, status, lastPaymentAt, remark, createdAt, updatedAt FROM DebtRecord ORDER BY createdAt DESC LIMIT ? OFFSET ?").all(pSize, (page - 1) * pSize) as DebtRecord[],
      (this.dbService.prepare("SELECT COUNT(*) as count FROM DebtRecord").get() as { count: number }).count,
    ]);
    return { items, total, page, pageSize: pSize };
  }

  async debtStats() {
    const r = this.dbService.prepare("SELECT COALESCE(SUM(debtAmount), 0) as total FROM DebtRecord WHERE status = ?").get("UNPAID") as { total: number };
    return { totalDebt: r?.total || 0 };
  }

  async getDebt(id: string) {
    const debt = this.dbService.prepare("SELECT id, chargeId, patientId, totalAmount, paidAmount, debtAmount, status, lastPaymentAt, remark, createdAt, updatedAt FROM DebtRecord WHERE id = ?").get(id) as DebtRecord | undefined;
    if (!debt) throw new NotFoundException("欠费记录不存在");
    return debt;
  }

  /**
   * P0.4 修复：createDebtFromCharge 改为依赖 DB 唯一约束（idx_debt_charge_unique）
   * 原 SELECT-then-INSERT 即使在事务内也无法防并发（两个事务同时 SELECT 都未发现，然后都 INSERT 成功）
   * 现在靠 UNIQUE INDEX 在 INSERT 时由 DB 强制拒绝第二个并发请求
   */
  async createDebtFromCharge(dto: CreateDebtDto) {
    return this.dbService.transaction((db) => {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      try {
        db.prepare(
          "INSERT INTO DebtRecord (id, chargeId, patientId, totalAmount, debtAmount, paidAmount, status, createdAt, updatedAt) VALUES (?,?,?,?,?,0,'UNPAID',?,?)"
        ).run(id, dto.chargeId || null, dto.patientId || null, dto.totalAmount || dto.debtAmount || 0, dto.debtAmount || 0, now, now);
      } catch (e: unknown) {
        if (e instanceof Error && e.message.includes('UNIQUE constraint failed') && dto.chargeId) {
          throw new BadRequestException("该收费项目已创建欠费记录");
        }
        throw e;
      }
      return { id };
    });
  }

  /**
   * P0.4 修复：欠费还款必须同步更新 Charge.paidAmount
   * 原代码只更新 DebtRecord.paidAmount，导致月度报表与实际现金流严重不符
   * 现在在同事务内同步：
   *   - DebtRecord.paidAmount += amount
   *   - Charge.paidAmount += amount（若 debt 关联 chargeId）
   *   - Charge.status 跟随更新（PARTIAL/PAID）
   *   - 写入 AuditLog
   */
  async payDebt(id: string, dto: PayDebtDto, _userId?: string) {
    // NaN 防御
    if (typeof dto.amount !== "number" || !Number.isFinite(dto.amount) || dto.amount <= 0) {
      throw new BadRequestException("支付金额必须为有效正数");
    }
    const amount = Number(dto.amount);
    const now = new Date().toISOString();
    return this.dbService.transaction((db) => {
      const debt = db.prepare("SELECT id, chargeId, patientId, totalAmount, paidAmount, debtAmount, status, lastPaymentAt, remark, createdAt, updatedAt FROM DebtRecord WHERE id = ?").get(id) as DebtRecord | undefined;
      if (!debt) throw new NotFoundException("欠费记录不存在");

      const debtBefore = { paidAmount: debt.paidAmount, debtAmount: debt.debtAmount, status: debt.status };

      // 更新 DebtRecord
      const result = db.prepare("UPDATE DebtRecord SET paidAmount = paidAmount + ?, lastPaymentAt = ?, updatedAt = ? WHERE id = ? AND paidAmount + ? <= debtAmount")
        .run(amount, now, now, id, amount);
      if (result.changes === 0) throw new BadRequestException("还款金额超出欠费总额");
      const updated = db.prepare("SELECT id, chargeId, patientId, totalAmount, paidAmount, debtAmount, status, lastPaymentAt, remark, createdAt, updatedAt FROM DebtRecord WHERE id = ?").get(id) as DebtRecord;
      const newPaid = Number(updated.paidAmount) || 0;
      const newStatus = moneyGreaterThanOrEqual(newPaid, Number(updated.debtAmount) || 0) ? "PAID" : "UNPAID";
      db.prepare("UPDATE DebtRecord SET status = ? WHERE id = ?").run(newStatus, id);

      // P0.4: 同步更新 Charge.paidAmount（两套账并行问题）
      let chargeSync: { chargeId: string; paidAmount: number; status: string } | null = null;
      if (updated.chargeId) {
        const chargeBefore = db.prepare("SELECT id, totalAmount, paidAmount, status FROM Charge WHERE id = ?").get(updated.chargeId) as { id: string; totalAmount: number; paidAmount: number; status: string } | undefined;
        if (chargeBefore) {
          const newChargePaid = roundMoney(Number(chargeBefore.paidAmount) + amount);
          const newChargeStatus = moneyGreaterThanOrEqual(newChargePaid, Number(chargeBefore.totalAmount))
            ? "PAID"
            : (moneyLessThanOrEqual(newChargePaid, 0) ? "UNPAID" : "PARTIAL");
          // 防御：还款不能让 Charge 超付
          if (moneyGreaterThan(newChargePaid, Number(chargeBefore.totalAmount))) {
            throw new BadRequestException("还款金额超过收费单应收金额");
          }
          db.prepare(
            "UPDATE Charge SET paidAmount = ?, status = ?, payMethod = COALESCE(payMethod, ?), paidAt = COALESCE(paidAt, ?), updatedAt = ? WHERE id = ?"
          ).run(newChargePaid, newChargeStatus, dto.payMethod || 'DEBT', now, now, updated.chargeId);
          chargeSync = { chargeId: updated.chargeId, paidAmount: newChargePaid, status: newChargeStatus };
        }
      }

      // 写入 AuditLog
      db.prepare(
        "INSERT INTO AuditLog (id, type, targetId, targetType, operatorId, amount, beforeData, afterData, remark, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(
        crypto.randomUUID(),
        "PAY_DEBT",
        id,
        "DebtRecord",
        _userId || null,
        amount,
        JSON.stringify({ debt: debtBefore, charge: chargeSync ? { chargeId: updated.chargeId } : null }),
        JSON.stringify({ debt: { paidAmount: newPaid, status: newStatus }, charge: chargeSync }),
        `欠费还款 ${amount}`,
        now,
      );

      return { id, paid: newPaid, charge: chargeSync };
    });
  }
}
