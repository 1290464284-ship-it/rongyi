// 随访/微信消息仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { SystemClock } from '../clock';
import { tenantAnd } from '../tenant';
import { keysetCondition, keysetOrder, nextCursorFrom } from '../keyset';
import { trackResourceWrite } from '../write-tracking';
import type { FollowUpRecord, FollowUpRepository, WechatMessageRepository } from '../../application/ports';

export class SqliteFollowUpRepository implements FollowUpRepository {
  constructor(private readonly db: Database.Database) {}

  reminders(
    clinicId?: string | null,
    options?: { page?: number; pageSize?: number; scope?: 'overdue' | 'today' | 'upcoming' | 'all'; cursor?: string | null },
  ): { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number; truncated?: boolean; nextCursor?: string | null } {
    const today = new SystemClock().clinicDate();
    const future = new SystemClock().clinicDate(Date.now() + 14 * 86_400_000);
    const rawPage = Number(options?.page);
    const rawPageSize = Number(options?.pageSize);
    const page = Number.isFinite(rawPage) && rawPage >= 1 ? Math.floor(rawPage) : 1;
    const pageSize = Number.isFinite(rawPageSize) && rawPageSize >= 1 ? Math.min(100, Math.floor(rawPageSize)) : 100;
    const offset = (page - 1) * pageSize;
    let scopeClause: string;
    let scopeParams: string[];
    switch (options?.scope) {
      case 'overdue':
        scopeClause = "F.status IN ('PENDING', 'IN_PROGRESS') AND F.deletedAt IS NULL AND F.planDate < ?";
        scopeParams = [today];
        break;
      case 'today':
        scopeClause = "F.status IN ('PENDING', 'IN_PROGRESS') AND F.deletedAt IS NULL AND F.planDate = ?";
        scopeParams = [today];
        break;
      case 'upcoming':
        scopeClause = "F.status IN ('PENDING', 'IN_PROGRESS') AND F.deletedAt IS NULL AND F.planDate > ?";
        scopeParams = [today];
        break;
      case 'all':
        scopeClause = "F.status IN ('PENDING', 'IN_PROGRESS') AND F.deletedAt IS NULL AND F.planDate IS NOT NULL";
        scopeParams = [];
        break;
      default:
        scopeClause = "F.status = 'PENDING' AND F.deletedAt IS NULL AND F.planDate <= ?";
        scopeParams = [future];
        break;
    }
    const params: Array<string | number> = [...scopeParams, ...(clinicId ? [clinicId] : [])];
    const tenantClause = tenantAnd(clinicId, 'F.clinicId');
    const where = `WHERE ${scopeClause}${tenantClause}`;
    const total = Number((this.db.prepare(
      `SELECT COUNT(*) AS total FROM FollowUp F ${where}`,
    ).get(...params) as { total: number }).total);
    // S-2 keyset：两模式统一按 (planDate ASC, id ASC) 排序，恒取 pageSize+1 行并回传 nextCursor。
    const keyset = { columns: [{ column: 'F.planDate', key: 'planDate' }], idColumn: 'F.id', direction: 'ASC' as const };
    const cursorCondition = keysetCondition(options?.cursor, keyset);
    const hasCursor = cursorCondition.where !== '';
    const items = this.db.prepare(
      `SELECT F.id, F.patientId, F.planDate, F.content, F.status,
              P.name AS patientName, P.phone AS patientPhone
       FROM FollowUp F
       LEFT JOIN Patient P ON P.id = F.patientId
       ${where}${cursorCondition.where}
       ${keysetOrder(keyset)}
       LIMIT ${pageSize + 1} OFFSET ${hasCursor ? 0 : offset}`,
    ).all(...params, ...cursorCondition.params) as Array<Record<string, unknown>>;
    return {
      items: items.slice(0, pageSize),
      total,
      page,
      pageSize,
      truncated: total > offset + items.slice(0, pageSize).length,
      nextCursor: nextCursorFrom(items, pageSize, keyset),
    };
  }

  insert(record: FollowUpRecord): void {
    this.db.prepare(
      `INSERT INTO FollowUp (
         id, clinicId, createdAt, updatedAt, deletedAt,
         patientId, planDate, content, status, assigneeId, templateId
       ) VALUES (?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      record.clinicId ?? null,
      record.createdAt,
      record.updatedAt,
      record.patientId,
      record.planDate,
      record.content ?? null,
      record.status,
      record.assigneeId ?? null,
      record.templateId ?? null,
    );
    trackResourceWrite(this.db, { tableName: 'FollowUp', recordId: record.id, operation: 'INSERT', clinicId: record.clinicId ?? null });
  }

  complete(id: string, completedAt: string, updatedAt: string, clinicId?: string | null, result?: string | null): number {
    const params = clinicId
      ? [completedAt, updatedAt, result ?? null, id, clinicId]
      : [completedAt, updatedAt, result ?? null, id];
    const changes = this.db.prepare(
      `UPDATE FollowUp SET status = 'COMPLETED', completedAt = ?, updatedAt = ?, result = ?
       WHERE id = ? AND deletedAt IS NULL AND status IN ('PENDING', 'IN_PROGRESS')${tenantAnd(clinicId)}`,
    ).run(...params).changes;
    if (changes > 0) {
      trackResourceWrite(this.db, { tableName: 'FollowUp', recordId: id, operation: 'UPDATE', clinicId: clinicId ?? null });
    }
    return changes;
  }
}

export class SqliteWechatMessageRepository implements WechatMessageRepository {
  constructor(private readonly db: Database.Database) {}

  findById(id: string, clinicId?: string | null): {
    id: string;
    status: string;
    clinicId?: string | null;
    patientId?: string | null;
    type?: string | null;
    content?: string | null;
    templateId?: string | null;
  } | null {
    const params = clinicId ? [id, clinicId] : [id];
    return (this.db.prepare(`SELECT id, status, clinicId, patientId, type, content, templateId FROM WechatMessage WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`).get(...params) as
      | {
          id: string;
          status: string;
          clinicId?: string | null;
          patientId?: string | null;
          type?: string | null;
          content?: string | null;
          templateId?: string | null;
        }
      | undefined) ?? null;
  }

  markSent(id: string, sentAt: string, updatedAt: string, clinicId?: string | null): number {
    return this.db.prepare(
      `UPDATE WechatMessage SET status = ?, sentAt = ?, result = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL AND status = 'IN_PROGRESS'${tenantAnd(clinicId)}`,
    ).run('SENT', sentAt, null, updatedAt, id, ...(clinicId ? [clinicId] : [])).changes;
  }
}
