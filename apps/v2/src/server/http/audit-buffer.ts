import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Logger } from '../infrastructure/logger';

export interface AuditInput {
  userId?: string | null;
  userName?: string | null;
  action: string;
  target?: string | null;
  detail?: string | null;
  ip?: string | null;
  traceId?: string | null;
  clinicId?: string | null;
  statusCode?: number | null;
}

export interface AuditBuffer {
  push: (input: AuditInput) => void;
  flushNow: () => void;
}

const AUDIT_FLUSH_INTERVAL = 1000;
const AUDIT_BUFFER_MAX = 50;
let shutdownFlushInstalled = false;

/**
 * 审计日志写缓冲：批量写入 OperationLog，避免每个请求一次事务。
 * - test 环境直接同步写入（spec 断言可见）；
 * - 生产环境缓冲，满 AUDIT_BUFFER_MAX 立即刷出，否则按 AUDIT_FLUSH_INTERVAL 定时刷；
 * - flush 失败后恰好重试一次（_auditRetryScheduled 保证同一时间最多一轮重试在途）；
 * - 进程退出（SIGINT/SIGTERM）时冲刷剩余缓冲。
 */
export function createAuditBuffer(db: Database.Database, logger: Logger): AuditBuffer {
  const auditBuffer: AuditInput[] = [];
  const insertAuditStmt = db.prepare(
    `INSERT INTO OperationLog (
       id, userId, userName, action, target, detail, ip, traceId,
       clinicId, statusCode, createdAt, updatedAt, deletedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );
  const flushAudit = db.transaction((rows: AuditInput[]) => {
    for (const input of rows) {
      const now = new Date().toISOString();
      insertAuditStmt.run(
        randomUUID(),
        input.userId ?? null,
        input.userName ?? null,
        input.action,
        input.target ?? null,
        input.detail ?? null,
        input.ip ?? null,
        input.traceId ?? null,
        input.clinicId ?? null,
        input.statusCode == null ? null : String(input.statusCode),
        now,
        now,
      );
    }
  });
  let _auditFlushScheduled = false;
  let _auditRetryScheduled = false;
  function scheduleAuditFlush(): void {
    if (_auditFlushScheduled) return;
    _auditFlushScheduled = true;
    setTimeout(() => {
      _auditFlushScheduled = false;
      if (auditBuffer.length === 0) return;
      const rows = auditBuffer.splice(0, auditBuffer.length);
      try {
        flushAudit(rows);
      } catch (error) {
        if (logger) logger.error('audit batch flush failed', { error });
        else console.error('audit batch flush failed', error);
        scheduleAuditRetry(rows);
      }
    }, AUDIT_FLUSH_INTERVAL).unref();
  }
  // M6-edge: flush 失败后恰好重试一次。_auditRetryScheduled 保证同一时间最多
  // 一轮重试在途（已有重试则放弃，仅记日志）；重试定时器到点时把失败行（已
  // 放回队首）与期间新入缓冲的行一起刷出；重试再失败只记日志，不再入队，
  // 避免无限重试。
  function scheduleAuditRetry(rows: AuditInput[]): void {
    if (_auditRetryScheduled) return;
    if (auditBuffer.length + rows.length > AUDIT_BUFFER_MAX * 2) {
      // B-H5：超限静默丢弃审计行会掩盖合规痕迹；丢弃前必须留告警日志。
      const dropped = rows.length;
      if (logger) logger.error('audit rows dropped (retry buffer over capacity)', { action: 'audit-drop', dropped });
      else console.error('audit rows dropped (retry buffer over capacity)', dropped);
      return;
    }
    auditBuffer.unshift(...rows);
    _auditRetryScheduled = true;
    setTimeout(() => {
      _auditRetryScheduled = false;
      if (auditBuffer.length === 0) return;
      const pending = auditBuffer.splice(0, auditBuffer.length);
      try {
        flushAudit(pending);
      } catch (error) {
        if (logger) logger.error('audit batch retry flush failed', { error });
        else console.error('audit batch retry flush failed', error);
      }
    }, AUDIT_FLUSH_INTERVAL).unref();
  }
  function pushAudit(input: AuditInput): void {
    if (process.env.NODE_ENV === 'test') {
      const now = new Date().toISOString();
      insertAuditStmt.run(
        randomUUID(),
        input.userId ?? null,
        input.userName ?? null,
        input.action,
        input.target ?? null,
        input.detail ?? null,
        input.ip ?? null,
        input.traceId ?? null,
        input.clinicId ?? null,
        input.statusCode == null ? null : String(input.statusCode),
        now,
        now,
      );
      return;
    }
    auditBuffer.push(input);
    if (auditBuffer.length >= AUDIT_BUFFER_MAX) {
      const rows = auditBuffer.splice(0, AUDIT_BUFFER_MAX);
      try {
        flushAudit(rows);
      } catch (error) {
        if (logger) logger.error('audit batch flush failed', { error });
        else console.error('audit batch flush failed', error);
        scheduleAuditRetry(rows);
      }
    } else {
      scheduleAuditFlush();
    }
  }
  function shutdownFlushAudit(): void {
    if (auditBuffer.length === 0) return;
    const rows = auditBuffer.splice(0, auditBuffer.length);
    try {
      flushAudit(rows);
    } catch (error) {
      if (logger) logger.error('audit shutdown flush failed', { error });
      else console.error('audit shutdown flush failed', error);
    }
  }
  if (!shutdownFlushInstalled) {
    shutdownFlushInstalled = true;
    process.once('SIGINT', shutdownFlushAudit);
    process.once('SIGTERM', shutdownFlushAudit);
  }
  return { push: pushAudit, flushNow: shutdownFlushAudit };
}
