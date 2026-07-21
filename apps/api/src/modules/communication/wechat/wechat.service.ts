import { Injectable, HttpException } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import * as crypto from "crypto";

@Injectable()
export class WechatService {
  constructor(private dbService: DbService) {}

  async sendMessage(dto: { patientId: string; type: string; content?: string; templateId?: string }) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.prepare(
      "INSERT INTO WechatMessage (id, patientId, type, content, status, templateId, createdAt) VALUES (?,?,?,?,?,?,?)"
    ).run(id, dto.patientId, dto.type, dto.content || null, "PENDING", dto.templateId || null, now);
    return { id, status: "PENDING" };
  }

  async findByPatient(patientId: string) {
    return this.dbService.prepare("SELECT * FROM WechatMessage WHERE patientId = ? ORDER BY createdAt DESC LIMIT 100").all(patientId);
  }

  async findMany(params: unknown, page = 1, pageSize = 20) {
    const p = params as { patientId?: string; type?: string; status?: string };
    let query = "SELECT * FROM WechatMessage WHERE 1=1";
    let countQuery = "SELECT COUNT(*) as count FROM WechatMessage WHERE 1=1";
    const qp: unknown[] = [];
    const cp: unknown[] = [];
    if (p?.patientId) { query += " AND patientId = ?"; countQuery += " AND patientId = ?"; qp.push(p.patientId); cp.push(p.patientId); }
    if (p?.type) { query += " AND type = ?"; countQuery += " AND type = ?"; qp.push(p.type); cp.push(p.type); }
    if (p?.status) { query += " AND status = ?"; countQuery += " AND status = ?"; qp.push(p.status); cp.push(p.status); }
    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp);
    const total = (this.dbService.prepare(countQuery).get(...cp) as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  // === Stub methods — throw 501 until implemented ===
  async getAppointmentReminders() { throw new HttpException('此功能尚未实现', 501); }
  async send(_dto: unknown) { throw new HttpException('此功能尚未实现', 501); }
  async sendBatch(_dto: unknown) { throw new HttpException('此功能尚未实现', 501); }
  async getBirthdayPatients() { throw new HttpException('此功能尚未实现', 501); }
}