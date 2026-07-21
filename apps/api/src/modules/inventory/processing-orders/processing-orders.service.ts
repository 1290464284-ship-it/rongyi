import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import * as crypto from "crypto";
import { UpdateBuilder } from "../../../common/utils/sql-builder";

interface CountRow { c: number; }

@Injectable()
export class ProcessingOrdersService {
  constructor(private dbService: DbService) {}

  async findMany(params: { patientId?: string; status?: string; factoryId?: string; page?: number; pageSize?: number }) {
    const { patientId, status, factoryId, page = 1, pageSize = 50 } = params;
    let query = "SELECT * FROM ProcessingOrder WHERE deletedAt IS NULL";
    const qp: unknown[] = [];
    if (patientId) { query += " AND patientId = ?"; qp.push(patientId); }
    if (status) { query += " AND status = ?"; qp.push(status); }
    if (factoryId) { query += " AND factoryId = ?"; qp.push(factoryId); }
    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp);
    let countQuery = "SELECT COUNT(*) as count FROM ProcessingOrder WHERE deletedAt IS NULL";
    const countParams: unknown[] = [];
    if (patientId) { countQuery += " AND patientId = ?"; countParams.push(patientId); }
    if (status) { countQuery += " AND status = ?"; countParams.push(status); }
    if (factoryId) { countQuery += " AND factoryId = ?"; countParams.push(factoryId); }
    const total = (this.dbService.prepare(countQuery).get(...countParams) as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const po = this.dbService.prepare("SELECT * FROM ProcessingOrder WHERE id = ? AND deletedAt IS NULL").get(id);
    if (!po) throw new NotFoundException("加工单不存在");
    return po;
  }

  async create(dto: { patientId: string; factoryId?: string; visitId?: string; doctorId?: string; shade?: string; teethNumbers?: string[]; totalFee?: number; remark?: string }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const number = "PO" + Date.now();
    this.dbService.prepare("INSERT INTO ProcessingOrder (id, number, patientId, visitId, factoryId, doctorId, shade, teethNumbers, totalFee, status, remark, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(id, number, dto.patientId, dto.visitId || null, dto.factoryId || null, dto.doctorId || null, dto.shade || null, JSON.stringify(dto.teethNumbers || []), dto.totalFee || 0, "SENT", dto.remark || null, now, now);
    return this.findOne(id);
  }

  async updateStatus(id: string, status: string) {
    await this.findOne(id);
    this.dbService.prepare("UPDATE ProcessingOrder SET status = ?, updatedAt = ? WHERE id = ?").run(status, new Date().toISOString(), id);
    return this.findOne(id);
  }

  async listProducts(factoryId?: string) { if (factoryId) { return this.dbService.prepare("SELECT * FROM ProcessingProduct WHERE factoryId = ? ORDER BY name").all(factoryId); } return this.dbService.prepare("SELECT * FROM ProcessingProduct ORDER BY name").all(); }
  async stats() {
    const total = (this.dbService.prepare("SELECT COUNT(*) as c FROM ProcessingOrder WHERE deletedAt IS NULL").get() as CountRow | undefined)?.c ?? 0;
    const completed = (this.dbService.prepare("SELECT COUNT(*) as c FROM ProcessingOrder WHERE deletedAt IS NULL AND status = 'RECEIVED'").get() as CountRow | undefined)?.c ?? 0;
    const pending = (this.dbService.prepare("SELECT COUNT(*) as c FROM ProcessingOrder WHERE deletedAt IS NULL AND status IN ('SENT','IN_PROGRESS')").get() as CountRow | undefined)?.c ?? 0;
    return { total, completed, pending };
  }
  
  async createProduct(dto: { factoryId: string; name: string; category?: string; price?: number; remark?: string }) {
    if (!dto.factoryId || !dto.name) throw new BadRequestException("工厂ID和产品名称不能为空");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.prepare("INSERT INTO ProcessingProduct (id, factoryId, name, category, price, remark, createdAt) VALUES (?,?,?,?,?,?,?)")
      .run(id, dto.factoryId, dto.name, dto.category || null, dto.price || 0, dto.remark || null, now);
    return this.dbService.prepare("SELECT * FROM ProcessingProduct WHERE id = ?").get(id);
  }
  
  async updateProduct(id: string, dto: { name?: string; category?: string; price?: number; remark?: string }) {
    const builder = new UpdateBuilder("ProcessingProduct");
    builder.set("name", dto.name);
    builder.set("category", dto.category);
    builder.set("price", dto.price);
    builder.set("remark", dto.remark);
    const result = builder.build(id);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    return this.dbService.prepare("SELECT * FROM ProcessingProduct WHERE id = ?").get(id);
  }
  
  async createFactory(dto: { name: string; contactPerson?: string; phone?: string; address?: string; remark?: string }) {
    if (!dto.name) throw new BadRequestException("工厂名称不能为空");
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.prepare("INSERT INTO ProcessingFactory (id, name, contactPerson, phone, address, remark, status, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?,?)")
      .run(id, dto.name, dto.contactPerson || null, dto.phone || null, dto.address || null, dto.remark || null, 'ACTIVE', now, now);
    return this.dbService.prepare("SELECT * FROM ProcessingFactory WHERE id = ?").get(id);
  }
  
  async updateFactory(id: string, dto: { name?: string; contactPerson?: string; phone?: string; address?: string; remark?: string; status?: string }) {
    const builder = new UpdateBuilder("ProcessingFactory");
    builder.set("name", dto.name);
    builder.set("contactPerson", dto.contactPerson);
    builder.set("phone", dto.phone);
    builder.set("address", dto.address);
    builder.set("remark", dto.remark);
    builder.set("status", dto.status);
    builder.setUpdatedAt();
    const result = builder.build(id);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    return this.dbService.prepare("SELECT * FROM ProcessingFactory WHERE id = ?").get(id);
  }
  
  async deleteFactory(id: string) {
    const existing = this.dbService.prepare("SELECT id FROM ProcessingFactory WHERE id = ?").get(id);
    if (!existing) throw new NotFoundException("工厂不存在");
    const orderCount = (this.dbService.prepare("SELECT COUNT(*) as c FROM ProcessingOrder WHERE factoryId = ? AND deletedAt IS NULL").get(id) as CountRow | undefined)?.c ?? 0;
    if (orderCount > 0) {
      // 有关联订单，软删除（设为 INACTIVE）
      this.dbService.prepare("UPDATE ProcessingFactory SET status = 'INACTIVE', updatedAt = ? WHERE id = ?").run(new Date().toISOString(), id);
    } else {
      this.dbService.prepare("DELETE FROM ProcessingFactory WHERE id = ?").run(id);
    }
    return { id };
  }
  
  async deleteProduct(id: string) {
    const existing = this.dbService.prepare("SELECT id FROM ProcessingProduct WHERE id = ?").get(id);
    if (!existing) throw new NotFoundException("产品不存在");
    this.dbService.prepare("DELETE FROM ProcessingProduct WHERE id = ?").run(id);
    return { id };
  }
  async findAll(params?: { page?: number; pageSize?: number }) {
    const { page = 1, pageSize = 50 } = params || {};
    const query = "SELECT * FROM ProcessingOrder WHERE deletedAt IS NULL ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    const items = this.dbService.prepare(query).all(pageSize, (page - 1) * pageSize);
    const total = (this.dbService.prepare("SELECT COUNT(*) as count FROM ProcessingOrder WHERE deletedAt IS NULL").get() as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }
  async remove(id: string) { await this.findOne(id); const n=new Date().toISOString(); this.dbService.prepare("UPDATE ProcessingOrder SET deletedAt=?,updatedAt=? WHERE id=?").run(n,n,id); return {id}; }
  async addFlowLog(orderId: string, dto: { status: string; remark?: string; operatorId?: string }) {
    await this.findOne(orderId);
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.transaction((db) => {
      db.prepare("INSERT INTO ProcessingFlowLog (id, orderId, status, remark, operatorId, createdAt) VALUES (?,?,?,?,?,?)")
        .run(id, orderId, dto.status, dto.remark || null, dto.operatorId || null, now);
      // 同步更新订单状态
      db.prepare("UPDATE ProcessingOrder SET status = ?, updatedAt = ? WHERE id = ?").run(dto.status, now, orderId);
    });
    return { id, orderId, status: dto.status };
  }
  async linkCharge(orderId: string, chargeId: string) { this.dbService.prepare("UPDATE ProcessingOrder SET chargeId=?,updatedAt=? WHERE id=?").run(chargeId,new Date().toISOString(),orderId); return {orderId,chargeId}; }
  async update(id: string, dto: { factoryId?: string; shade?: string; teethNumbers?: string[]; totalFee?: number; remark?: string }) {
    await this.findOne(id);
    const builder = new UpdateBuilder("ProcessingOrder");
    builder.set("factoryId", dto.factoryId || null);
    builder.set("shade", dto.shade);
    builder.set("teethNumbers", dto.teethNumbers !== undefined ? JSON.stringify(dto.teethNumbers) : undefined);
    builder.set("totalFee", dto.totalFee);
    builder.set("remark", dto.remark);
    builder.setUpdatedAt();
    const result = builder.build(id);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    return this.findOne(id);
  }
  async listFactories() { return this.dbService.prepare("SELECT * FROM ProcessingFactory WHERE deletedAt IS NULL ORDER BY name").all(); }
}