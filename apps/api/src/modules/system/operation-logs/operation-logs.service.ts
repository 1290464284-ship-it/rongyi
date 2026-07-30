import { Injectable } from '@nestjs/common';
import { DbService } from "../../../db/db.service";
import * as crypto from "node:crypto";
import * as path from "node:path";
import { AppLogger } from "../../../common/services/logger.service";
import { ClinicContextService } from "../../../common/services/clinic-context.service";
import { BufferedWriter } from "../../../common/utils/infra/buffered-writer";
import { OperationLogEntry, OperationLogSink } from "../../../common/services/operation-log-sink.interface";
import { buildClinicFilter } from "../../../common/utils/db/clinic-filter";
import { PAGINATION } from "../../../common/constants/pagination";

const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 2000;
// D2-2: 队列上限，防止数据库故障时 OOM
const MAX_QUEUE_SIZE = 10000;
// D2-2: 连续失败次数达到阈值后启用文件降级
const FALLBACK_THRESHOLD = 3;
const FALLBACK_FILE_PREFIX = "operation-log-fallback";

// 保持与原实现一致的数据目录解析逻辑
const DATA_DIR = process.env.DATA_DIR || process.env.DB_PATH
  ? path.dirname(process.env.DB_PATH || '')
  : path.join(__dirname, '../../../data');

@Injectable()
export class OperationLogsService extends BufferedWriter<OperationLogEntry> implements OperationLogSink {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- AppLogger is a compatible logger superset
  protected logger: { error: (msg: string, err?: unknown) => void; warn: (msg: string) => void } = new AppLogger(OperationLogsService.name) as any;

  constructor(
    private dbService: DbService,
    private clinicContext: ClinicContextService,
  ) {
    super({
      batchSize: BATCH_SIZE,
      flushIntervalMs: FLUSH_INTERVAL_MS,
      maxQueueSize: MAX_QUEUE_SIZE,
      fallbackThreshold: FALLBACK_THRESHOLD,
      fallbackFilePrefix: FALLBACK_FILE_PREFIX,
      dataDir: DATA_DIR,
    });
  }

  protected batchInsert(entries: OperationLogEntry[]): void {
    if (entries.length === 0) return;
    const placeholders = entries.map(() => "(?,?,?,?,?,?,?,?,?)").join(", ");
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
        data.clinicId ?? 'system',
        now
      );
    }
    this.dbService.prepare(
      `INSERT INTO OperationLog (id, userId, userName, action, target, detail, ip, clinicId, createdAt) VALUES ${placeholders}`
    ).run(...values);
  }

  protected insertOne(entry: OperationLogEntry): void {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.dbService.prepare(
      "INSERT INTO OperationLog (id, userId, userName, action, target, detail, ip, clinicId, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(id, entry.userId ?? null, entry.userName ?? null, entry.action, entry.target ?? null, entry.detail ?? null, entry.ip ?? null, entry.clinicId ?? 'system', now);
  }

  // D2-2: 数据库不可用时降级写入文件的序列化逻辑
  protected serializeForFile(entry: OperationLogEntry): string {
    return JSON.stringify({ ...entry, timestamp: new Date().toISOString(), clinicId: entry.clinicId ?? 'system' });
  }

  async create(data: OperationLogEntry) {
    // 在 enqueue 时捕获 clinicId，避免 flush 时 AsyncLocalStorage 上下文丢失
    // 对于无诊所上下文的操作（如登录失败），使用 'system' 哨兵值
    const clinicId = this.clinicContext.getClinicId() ?? 'system';
    return this.enqueue({ ...data, clinicId });
  }

  async findMany(params: { userId?: string; action?: string; startDate?: string; endDate?: string; page?: number; pageSize?: number }) {
    const { userId, action, startDate, endDate, page = 1, pageSize = PAGINATION.DEFAULT_PAGE_SIZE_MEDIUM } = params;
    // D1-2: 添加 clinicId 过滤
    const { clause: clinicClause, params: clinicParams } = buildClinicFilter(this.clinicContext.getClinicId());
    let query = "SELECT id, userId, userName, action, target, ip, createdAt FROM OperationLog WHERE 1=1" + clinicClause;
    let countQuery = "SELECT COUNT(*) as count FROM OperationLog WHERE 1=1" + clinicClause;
    const qp: unknown[] = [...clinicParams];
    const cp: unknown[] = [...clinicParams];
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

  async log(data: unknown) { return this.create(data as OperationLogEntry); }
}
