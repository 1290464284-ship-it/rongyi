import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import * as crypto from "crypto";
import { multiplyMoney, sumMoney } from "../../../common/utils/money.utils";

export interface PurchaseOrder {
  id: string;
  number: string;
  supplierId: string | null;
  totalAmount: number;
  status: string;
  operatorId: string | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface UserInfo {
  id?: string;
  name?: string;
}

@Injectable()
export class PurchaseOrdersService {
  constructor(private dbService: DbService) {}

  async findMany(params: { supplierId?: string; status?: string; page?: number; pageSize?: number }) {
    const { supplierId, status, page = 1, pageSize = 50 } = params;
    let query = "SELECT * FROM PurchaseOrder WHERE 1=1";
    const qp: unknown[] = [];
    if (supplierId) { query += " AND supplierId = ?"; qp.push(supplierId); }
    if (status) { query += " AND status = ?"; qp.push(status); }
    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp);
    const countQuery = "SELECT COUNT(*) as count FROM PurchaseOrder WHERE 1=1" +
      (supplierId ? " AND supplierId = ?" : "") + (status ? " AND status = ?" : "");
    const countParams: unknown[] = [];
    if (supplierId) countParams.push(supplierId);
    if (status) countParams.push(status);
    const total = (this.dbService.prepare(countQuery).get(...countParams) as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  async findOne(id: string): Promise<PurchaseOrder> {
    const po = this.dbService.prepare("SELECT * FROM PurchaseOrder WHERE id = ?").get(id) as PurchaseOrder | undefined;
    if (!po) throw new NotFoundException("采购单不存在");
    return po;
  }

  async create(dto: { supplierId: string; items: Array<{ itemId?: string; name: string; spec?: string; quantity: number; unitPrice: number }> }, user?: UserInfo) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const totalAmount = sumMoney(dto.items.map(i => multiplyMoney(i.quantity, i.unitPrice)));
    const number = "PO" + Date.now();
    this.dbService.transaction((db) => {
      db.prepare("INSERT INTO PurchaseOrder (id, number, supplierId, totalAmount, status, operatorId, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)")
        .run(id, number, dto.supplierId, totalAmount, "PENDING", user?.id || null, now, now);

      if (dto.items.length > 0) {
        const placeholders = dto.items.map(() => "(?,?,?,?,?,?,?,?)").join(", ");
        const values: unknown[] = [];
        for (const item of dto.items) {
          values.push(crypto.randomUUID(), id, item.itemId || null, item.name, item.spec || null, item.quantity, item.unitPrice, multiplyMoney(item.quantity, item.unitPrice));
        }
        db.prepare(`INSERT INTO PurchaseOrderItem (id, orderId, itemId, name, spec, quantity, unitPrice, subtotal) VALUES ${placeholders}`).run(...values);
      }
    });
    return this.findOne(id);
  }

  async updateStatus(id: string, status: string) {
    await this.findOne(id);
    this.dbService.prepare("UPDATE PurchaseOrder SET status = ?, updatedAt = ? WHERE id = ?").run(status, new Date().toISOString(), id);
    return this.findOne(id);
  }

  async receive(id: string, user?: any) {
    const po = await this.findOne(id);
    if (po.status === 'RECEIVED') throw new BadRequestException('采购单已收货，不可重复操作');
    if (po.status !== 'PENDING' && po.status !== 'PARTIAL') throw new BadRequestException('当前状态不可收货');

    const now = new Date().toISOString();

    const result = this.dbService.transaction((db) => {
      const currentPo = db.prepare("SELECT * FROM PurchaseOrder WHERE id = ?").get(id) as PurchaseOrder | undefined;
      if (!currentPo) throw new NotFoundException("采购单不存在");
      if (currentPo.status === 'RECEIVED') throw new BadRequestException('采购单已收货，不可重复操作');
      if (currentPo.status !== 'PENDING' && currentPo.status !== 'PARTIAL') throw new BadRequestException('当前状态不可收货');

      const items = db.prepare("SELECT * FROM PurchaseOrderItem WHERE orderId = ?").all(id) as Array<{ id: string; itemId: string | null; name: string; quantity: number; unitPrice: number }>;

      const itemIds = items.filter(i => i.itemId).map(i => i.itemId) as string[];
      const inventoryMap = new Map<string, Record<string, unknown>>();
      if (itemIds.length > 0) {
        const placeholders = itemIds.map(() => '?').join(',');
        const inventoryItems = db.prepare(`SELECT * FROM InventoryItem WHERE id IN (${placeholders}) AND deletedAt IS NULL`).all(...itemIds) as Array<Record<string, unknown>>;
        inventoryItems.forEach(item => inventoryMap.set(item.id as string, item));
      }

      const txValues: unknown[] = [];
      const txPlaceholders: string[] = [];
      for (const item of items) {
        if (item.itemId && inventoryMap.has(item.itemId)) {
          db.prepare("UPDATE InventoryItem SET stock = stock + ?, updatedAt = ? WHERE id = ?").run(item.quantity, now, item.itemId);
          txPlaceholders.push("(?,?,?,?,?,?,?,?,?,?,?)");
          txValues.push(
            crypto.randomUUID(), item.itemId, 'IN', item.quantity, item.unitPrice,
            multiplyMoney(item.unitPrice, item.quantity), po.supplierId, id, user?.id || null,
            user?.name || null, '采购入库'
          );
        }
      }

      if (txPlaceholders.length > 0) {
        db.prepare(`INSERT INTO InventoryTransaction (id, itemId, type, quantity, unitPrice, totalAmount, supplierId, purchaseOrderId, operatorId, operatorName, remark) VALUES ${txPlaceholders.join(', ')}`).run(...txValues);
      }

      const updateResult = db.prepare("UPDATE PurchaseOrder SET status = 'RECEIVED', updatedAt = ? WHERE id = ? AND status IN ('PENDING', 'PARTIAL')").run(now, id);
      if (updateResult.changes === 0) {
        throw new BadRequestException('采购单状态已变更，请刷新后重试');
      }

      return db.prepare("SELECT * FROM PurchaseOrder WHERE id = ?").get(id);
    });
    return result;
  }

  async cancel(id: string) {
    const po = await this.findOne(id);
    if (po.status === 'RECEIVED') throw new BadRequestException('已收货的采购单不可取消，请先做退货处理');
    if (po.status === 'CANCELLED') throw new BadRequestException('采购单已取消');
    const now = new Date().toISOString();
    this.dbService.prepare("UPDATE PurchaseOrder SET status = 'CANCELLED', updatedAt = ? WHERE id = ?").run(now, id);
    return this.findOne(id);
  }
}