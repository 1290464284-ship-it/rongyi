import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import { BaseService } from "../../../common/services/base.service";
import { InventoryItem } from "@dental/shared";
import * as crypto from "crypto";

interface CreateInventoryItemDto {
  code: string;
  name: string;
  spec?: string | null;
  category: string;
  unit: string;
  stock?: number;
  minStock?: number;
  price?: number;
  supplierId?: string | null;
  expireDate?: string | null;
  location?: string | null;
  remark?: string | null;
}

@Injectable()
export class InventoryService extends BaseService<InventoryItem> {
  constructor(dbService: DbService) {
    super(dbService, "InventoryItem", [], ["name","code"], [{ table: "InventoryTransaction", foreignKey: "itemId" }], true, ["code"]);
  }

  async create(dto: Partial<InventoryItem>): Promise<InventoryItem> {
    const createDto = dto as unknown as CreateInventoryItemDto;
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.prepare("INSERT INTO InventoryItem (id, code, name, spec, category, unit, stock, minStock, price, supplierId, expireDate, location, remark, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, createDto.code, createDto.name, createDto.spec || null, createDto.category, createDto.unit, createDto.stock || 0, createDto.minStock || 0, createDto.price || 0, createDto.supplierId || null, createDto.expireDate || null, createDto.location || null, createDto.remark || null, now, now);
    return super.findOne(id);
  }

  async update(id: string, dto: Partial<{ code: string; name: string; spec: string; category: string; unit: string; stock: number; minStock: number; price: number; supplierId: string; expireDate: string; location: string; remark: string }>) {
    // P1 修复（库存 update 绕过流水）：禁止直接修改 stock，必须通过 stockAction API 留下交易记录
    if (dto.stock !== undefined) {
      throw new BadRequestException("禁止直接修改库存数量，请使用入库/出库/调整 API（stockAction）以留下交易流水");
    }
    const COLUMN_NAME_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
    const updates: string[] = [];
    const params: unknown[] = [];
    const fields: Record<string, unknown> = { ...dto };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) {
        if (!COLUMN_NAME_REGEX.test(key)) throw new Error(`Invalid column name: ${key}`);
        updates.push(`${key} = ?`);
        params.push(value);
      }
    }
    if (updates.length === 0) return super.findOne(id);
    params.push(new Date().toISOString(), id);
    this.dbService.prepare(`UPDATE InventoryItem SET ${updates.join(', ')}, updatedAt = ? WHERE id = ?`).run(...params);
    return super.findOne(id);
  }

  async findLowStockItems() { return this.dbService.prepare("SELECT * FROM InventoryItem WHERE deletedAt IS NULL AND stock <= minStock ORDER BY stock ASC").all(); }
  async findTransactions(itemId?: string) {
    if (itemId) return this.dbService.prepare("SELECT * FROM InventoryTransaction WHERE itemId=? ORDER BY createdAt DESC").all(itemId);
    return this.dbService.prepare("SELECT * FROM InventoryTransaction ORDER BY createdAt DESC").all();
  }

  async stockAction(dto: { itemId: string; type: string; quantity: number; unitPrice?: number; supplierId?: string; remark?: string; operatorId?: string; operatorName?: string }) {
    const now = new Date().toISOString();
    const result = this.dbService.transaction((db) => {
      const item = db.prepare("SELECT * FROM InventoryItem WHERE id = ? AND deletedAt IS NULL").get(dto.itemId) as Record<string, unknown> | undefined;
      if (!item) throw new NotFoundException("库存项不存在");

      let newStock: number;
      if (dto.type === 'IN') {
        const updateResult = db.prepare("UPDATE InventoryItem SET stock = stock + ?, updatedAt = ? WHERE id = ?").run(dto.quantity, now, dto.itemId);
        if (updateResult.changes === 0) throw new BadRequestException("库存更新失败");
        newStock = (Number(item.stock) || 0) + dto.quantity;
      } else if (dto.type === 'OUT') {
        const updateResult = db.prepare("UPDATE InventoryItem SET stock = stock - ?, updatedAt = ? WHERE id = ? AND stock >= ?").run(dto.quantity, now, dto.itemId, dto.quantity);
        if (updateResult.changes === 0) throw new BadRequestException("库存不足");
        newStock = (Number(item.stock) || 0) - dto.quantity;
      } else if (dto.type === 'ADJUST') {
        if (dto.quantity < 0) throw new BadRequestException("调整数量不能为负");
        const updateResult = db.prepare("UPDATE InventoryItem SET stock = ?, updatedAt = ? WHERE id = ?").run(dto.quantity, now, dto.itemId);
        if (updateResult.changes === 0) throw new BadRequestException("库存更新失败");
        newStock = dto.quantity;
      } else {
        throw new BadRequestException("无效的库存操作类型");
      }

      const txId = crypto.randomUUID();
      db.prepare("INSERT INTO InventoryTransaction (id, itemId, type, quantity, unitPrice, totalAmount, supplierId, operatorId, operatorName, remark) VALUES (?,?,?,?,?,?,?,?,?,?)")
        .run(txId, dto.itemId, dto.type, dto.quantity, dto.unitPrice || 0, (dto.unitPrice || 0) * dto.quantity, dto.supplierId || null, dto.operatorId || null, dto.operatorName || null, dto.remark || null);
      return { id: txId, stock: newStock };
    });
    return result;
  }
}
