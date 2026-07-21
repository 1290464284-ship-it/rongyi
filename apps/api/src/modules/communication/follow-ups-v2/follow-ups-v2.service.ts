import { Injectable, NotFoundException, HttpException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import * as crypto from "crypto";
import { UpdateBuilder } from "../../../common/utils/sql-builder";
import { sanitizeData } from "../../../common/utils/sanitize-config";

function notImplemented() { throw new HttpException('此功能尚未实现', 501); }

@Injectable()
export class FollowUpsV2Service {
  constructor(private dbService: DbService) {}

  async findMany(params: { patientId?: string; status?: string; assigneeId?: string; page?: number; pageSize?: number }) {
    const { patientId, status, assigneeId, page = 1, pageSize = 50 } = params;
    let query = "SELECT * FROM FollowUp WHERE deletedAt IS NULL";
    let countQuery = "SELECT COUNT(*) as count FROM FollowUp WHERE deletedAt IS NULL";
    const qp: unknown[] = [];
    const countQp: unknown[] = [];
    if (patientId) { query += " AND patientId = ?"; countQuery += " AND patientId = ?"; qp.push(patientId); countQp.push(patientId); }
    if (status) { query += " AND status = ?"; countQuery += " AND status = ?"; qp.push(status); countQp.push(status); }
    if (assigneeId) { query += " AND assigneeId = ?"; countQuery += " AND assigneeId = ?"; qp.push(assigneeId); countQp.push(assigneeId); }
    query += " ORDER BY planDate ASC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp);
    const total = (this.dbService.prepare(countQuery).get(...countQp) as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  async findOne(id: string) {
    const fu = this.dbService.prepare("SELECT * FROM FollowUp WHERE id = ? AND deletedAt IS NULL").get(id);
    if (!fu) throw new NotFoundException("随访记录不存在");
    return fu;
  }

  async create(dto: { patientId: string; planDate: string; content?: string; assigneeId?: string }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const safeDto = sanitizeData('FollowUp', dto as Record<string, unknown>);
    this.dbService.prepare("INSERT INTO FollowUp (id, patientId, planDate, content, status, assigneeId, createdAt, updatedAt) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, safeDto.patientId, safeDto.planDate, safeDto.content || null, "PENDING", safeDto.assigneeId || null, now, now);
    return this.findOne(id);
  }

  async complete(id: string, result?: string) {
    await this.findOne(id);
    const now = new Date().toISOString();
    const safeResult = sanitizeData('FollowUp', { result }) as { result?: string };
    this.dbService.prepare("UPDATE FollowUp SET status = 'COMPLETED', result = ?, completedAt = ?, updatedAt = ? WHERE id = ?")
      .run(safeResult.result || null, now, now, id);
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    const now = new Date().toISOString();
    this.dbService.prepare("UPDATE FollowUp SET deletedAt = ?, status = 'CANCELLED', updatedAt = ? WHERE id = ?").run(now, now, id);
    return { id };
  }

  async update(id: string, dto: { status?: string; content?: string; planDate?: string; assigneeId?: string }) {
    await this.findOne(id);
    const safeDto = sanitizeData('FollowUp', dto as Record<string, unknown>);
    const builder = new UpdateBuilder("FollowUp");
    builder.set("status", safeDto.status as string | undefined);
    builder.set("content", safeDto.content as string | undefined);
    builder.set("planDate", safeDto.planDate as string | undefined);
    builder.set("assigneeId", safeDto.assigneeId as string | undefined);
    builder.setUpdatedAt();
    const result = builder.build(id);
    if (result) {
      this.dbService.prepare(result.sql).run(...result.params);
    }
    return this.findOne(id);
  }

  // === Stub methods — throw 501 until implemented ===
  async deleteAutoRule(_id: string) { notImplemented(); }
  async deleteItem(_id: string) { notImplemented(); }
  async workloadStats() { notImplemented(); }
  async createItem(_dto: unknown) { notImplemented(); }
  async listResults() { return this.dbService.prepare('SELECT * FROM FollowUpResult ORDER BY category LIMIT 200').all(); }
  async toggleTemplate(_id: string) { notImplemented(); }
  async listItems(templateId: string) { return this.dbService.prepare('SELECT * FROM FollowUpItem WHERE templateId=? ORDER BY sortOrder LIMIT 200').all(templateId); }
  async deleteTemplate(_id: string) { notImplemented(); }
  async createTemplate(_dto: unknown) { notImplemented(); }
  async updateItem(_id: string, _dto: unknown) { notImplemented(); }
  async deleteResult(_id: string) { notImplemented(); }
  async listTemplates() { return this.dbService.prepare('SELECT * FROM FollowUpTemplate ORDER BY createdAt DESC LIMIT 200').all(); }
  async findAll(params?: { page?: number; pageSize?: number }) {
    const { page = 1, pageSize = 50 } = params || {};
    const query = "SELECT * FROM FollowUp WHERE deletedAt IS NULL ORDER BY planDate ASC LIMIT ? OFFSET ?";
    const items = this.dbService.prepare(query).all(pageSize, (page - 1) * pageSize);
    const total = (this.dbService.prepare("SELECT COUNT(*) as count FROM FollowUp WHERE deletedAt IS NULL").get() as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }
  async toggleAutoRule(_id: string) { notImplemented(); }
  async createAutoRule(_dto: unknown) { notImplemented(); }
  async updateAutoRule(_id: string, _dto: unknown) { notImplemented(); }
  async updateTemplate(_id: string, _dto: unknown) { notImplemented(); }
  async updateResult(_id: string, _dto: unknown) { notImplemented(); }
  async listAutoRules() { return this.dbService.prepare('SELECT * FROM AutoFollowUpRule ORDER BY createdAt DESC').all(); }
  async npsStats() { notImplemented(); }
  async createResult(_dto: unknown) { notImplemented(); }
}