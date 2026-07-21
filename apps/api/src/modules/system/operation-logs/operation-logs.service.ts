import { Injectable, OnModuleInit, OnModuleDestroy } from "@nestjs/common";
import { DbService } from "../../../db/db.service";
import * as crypto from "crypto";
import { AppLogger } from "../../../common/services/logger.service";

interface LogEntry {
  userId?: string;
  userName?: string;
  action: string;
  target?: string;
  detail?: string;
  ip?: string;
}

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 2000;

@Injectable()
export class OperationLogsService implements OnModuleInit, OnModuleDestroy {
  private logger = new AppLogger(OperationLogsService.name);
  constructor(private dbService: DbService) {}

  private queue: LogEntry[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  onModuleInit() {
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  private flush() {
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, Math.min(BATCH_SIZE, this.queue.length));
    try {
      this.batchInsert(batch);
    } catch (err) {
      this.logger.error('batch insert failed', err);
      for (const entry of batch) {
        try {
          this.createSync(entry);
        } catch (e) {
          this.logger.error('fallback insert failed', e);
        }
      }
    }
  }

  private batchInsert(entries: LogEntry[]) {
    if (entries.length === 0) return;
    const placeholders = entries.map(() => "(?,?,?,?,?,?,?,?)").join(", ");
    const values: unknown[] = [];
    const now = new Date().toISOString();
    for (const data of entries) {
      values.push(
        crypto.randomUUID(),
        data.userId ?? null,
        data.userName ?? null,
        data.action,
        data.target ?? null,
        data.detail ?? null,
        data.ip ?? null,
        now
      );
    }
    this.dbService.prepare(
      `INSERT INTO OperationLog (id, userId, userName, action, target, detail, ip, createdAt) VALUES ${placeholders}`
    ).run(...values);
  }

  private createSync(data: LogEntry) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.prepare(
      "INSERT INTO OperationLog (id, userId, userName, action, target, detail, ip, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, data.userId ?? null, data.userName ?? null, data.action, data.target ?? null, data.detail ?? null, data.ip ?? null, now);
    return { id };
  }

  async create(data: LogEntry) {
    this.queue.push(data);
    if (this.queue.length >= BATCH_SIZE) {
      this.flush();
    }
    return { id: crypto.randomUUID() };
  }

  async findMany(params: { userId?: string; action?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number }) {
    const { userId, action, startDate, endDate, page = 1, pageSize = 50 } = params;
    let query = "SELECT * FROM OperationLog WHERE 1=1";
    let countQuery = "SELECT COUNT(*) as count FROM OperationLog WHERE 1=1";
    const qp: unknown[] = [];
    const cp: unknown[] = [];
    if (userId) { query += " AND userId = ?"; countQuery += " AND userId = ?"; qp.push(userId); cp.push(userId); }
    if (action) { query += " AND action = ?"; countQuery += " AND action = ?"; qp.push(action); cp.push(action); }
    if (startDate) { query += " AND createdAt >= ?"; countQuery += " AND createdAt >= ?"; qp.push(startDate); cp.push(startDate); }
    if (endDate) { query += " AND createdAt <= ?"; countQuery += " AND createdAt <= ?"; qp.push(endDate); cp.push(endDate); }
    query += " ORDER BY createdAt DESC LIMIT ? OFFSET ?";
    qp.push(pageSize, (page - 1) * pageSize);
    const items = this.dbService.prepare(query).all(...qp);
    const total = (this.dbService.prepare(countQuery).get(...cp) as { count: number })?.count || 0;
    return { items, total, page, pageSize };
  }

  async log(data: unknown) { return this.create(data as LogEntry); }
}