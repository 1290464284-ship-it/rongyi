// 随访/微信消息仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { SystemClock } from '../clock';
import { tenantAnd } from '../tenant';
import type { FollowUpRecord, FollowUpRepository, WechatMessageRepository } from '../../application/ports';

export class SqliteFollowUpRepository implements FollowUpRepository {
  constructor(private readonly db: Database.Database) {}

  reminders(clinicId?: string | null): Array<Record<string, unknown>> {
    const future = new SystemClock().clinicDate(Date.now() + 14 * 86_400_000);
    const params = clinicId ? [future, clinicId] : [future];
    return this.db.prepare(
      `SELECT F.id, F.patientId, F.planDate, F.content, F.status,
              P.name AS patientName, P.phone AS patientPhone
       FROM FollowUp F
       LEFT JOIN Patient P ON P.id = F.patientId
       WHERE F.status = 'PENDING' AND F.deletedAt IS NULL AND F.planDate <= ?${tenantAnd(clinicId, 'F.clinicId')}
       ORDER BY F.planDate ASC
       LIMIT 100`,
    ).all(...params) as Array<Record<string, unknown>>;
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
  }

  complete(id: string, completedAt: string, updatedAt: string, clinicId?: string | null, result?: string | null): number {
    const params = clinicId
      ? [completedAt, updatedAt, result ?? null, id, clinicId]
      : [completedAt, updatedAt, result ?? null, id];
    return this.db.prepare(
      `UPDATE FollowUp SET status = 'COMPLETED', completedAt = ?, updatedAt = ?, result = ?
       WHERE id = ? AND deletedAt IS NULL AND status IN ('PENDING', 'IN_PROGRESS')${tenantAnd(clinicId)}`,
    ).run(...params).changes;
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
