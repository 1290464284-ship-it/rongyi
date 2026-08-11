// 随访服务（M-04：由 operations.ts 拆分）
import { randomUUID } from 'node:crypto';
import Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { SqliteFollowUpRepository } from '../../infrastructure/repositories/core.repositories';
import { SystemClock } from '../../infrastructure/clock';
import { tenantAnd, tenantParams, tenantWhere } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';
import type { FollowUpRepository } from '../ports';

export class FollowUpService {
  private readonly db: Database.Database;
  private readonly followUpRepository: FollowUpRepository;

  constructor(db: Database.Database, followUpRepository?: FollowUpRepository) {
    this.db = db;
    this.followUpRepository = followUpRepository ?? new SqliteFollowUpRepository(db);
  }

  reminders(
    context: AppContext,
    options?: { page?: number; pageSize?: number; scope?: 'overdue' | 'today' | 'upcoming' | 'all' },
  ): { items: Array<Record<string, unknown>>; total: number; page: number; pageSize: number; truncated?: boolean } {
    return this.followUpRepository.reminders(context.clinicId, options);
  }

  summary(context: AppContext): { total: number; overdue: number; today: number; upcoming: number } {
    const today = new SystemClock().clinicDate();
    const tenant = tenantWhere(context.clinicId);
    const params = [today, today, today, ...tenant.params];
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN planDate < ? THEN 1 ELSE 0 END), 0) AS overdue,
              COALESCE(SUM(CASE WHEN planDate = ? THEN 1 ELSE 0 END), 0) AS today,
              COALESCE(SUM(CASE WHEN planDate > ? THEN 1 ELSE 0 END), 0) AS upcoming
       FROM FollowUp
       WHERE status IN ('PENDING', 'IN_PROGRESS')
         AND planDate IS NOT NULL
         AND deletedAt IS NULL
         ${tenant.sql ? `AND ${tenant.sql}` : ''}`,
    ).get(...params) as { total: number; overdue: number; today: number; upcoming: number };
    return {
      total: Number(row.total),
      overdue: Number(row.overdue),
      today: Number(row.today),
      upcoming: Number(row.upcoming),
    };
  }

  complete(id: string, context: AppContext, result?: string | null): Record<string, unknown> {
    const row = this.db.prepare(
      `SELECT id, status FROM FollowUp WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as { id: string; status: string } | undefined;
    if (!row) throw new NotFoundError('Follow-up not found');
    if (!['PENDING', 'IN_PROGRESS'].includes(row.status)) {
      throw new ConflictError('Follow-up cannot be completed from current status');
    }
    const normalizedResult = typeof result === 'string' && result.trim() ? result.trim() : null;
    if (normalizedResult && normalizedResult.length > 500) {
      throw new ValidationError('Follow-up result must be at most 500 characters');
    }
    const now = context.now().toISOString();
    const changes = this.followUpRepository.complete(id, now, now, context.clinicId, normalizedResult);
    if (changes === 0) throw new ConflictError('Follow-up cannot be completed');
    return { id, status: 'COMPLETED', completedAt: now, result: normalizedResult };
  }

  batchComplete(
    ids: string[],
    context: AppContext,
    result?: string | null,
  ): { completed: number; skipped: number; errors: string[] } {
    if (!Array.isArray(ids) || ids.length === 0 || ids.length > 500) {
      throw new ValidationError('Follow-up ids must be an array with 1 to 500 items');
    }
    const normalizedResult = typeof result === 'string' && result.trim() ? result.trim() : null;
    if (normalizedResult && normalizedResult.length > 500) {
      throw new ValidationError('Follow-up result must be at most 500 characters');
    }
    const now = context.now().toISOString();
    const errors: string[] = [];
    let completed = 0;
    const run = this.db.transaction(() => {
      const placeholders = ids.map(() => '?').join(',');
      const sql = `SELECT id, status FROM FollowUp WHERE id IN (${placeholders}) AND deletedAt IS NULL${tenantAnd(context.clinicId)}`;
      const params = [...ids, ...tenantParams(context.clinicId)];
      const rows = this.db.prepare(sql).all(...params) as Array<{ id: string; status: string }>;
      const rowMap = new Map(rows.map((r) => [r.id, r.status]));
      for (const id of ids) {
        const status = rowMap.get(id);
        if (!status) {
          errors.push(`随访记录不存在：${id}`);
          continue;
        }
        if (!['PENDING', 'IN_PROGRESS'].includes(status)) {
          errors.push(`当前状态不能完成随访：${id}`);
          continue;
        }
        const changes = this.followUpRepository.complete(id, now, now, context.clinicId, normalizedResult);
        if (changes === 0) {
          errors.push(`随访无法完成：${id}`);
        } else {
          completed += 1;
        }
      }
    });
    run();
    return { completed, skipped: errors.length, errors };
  }

  remindersCsv(scope: string, context: AppContext, maxRows = 50_000): string {
    const allowed = new Set(['overdue', 'today', 'upcoming', 'all']);
    if (!allowed.has(scope)) {
      throw new ValidationError('Follow-up export scope must be overdue, today, upcoming, or all');
    }
    const today = new SystemClock().clinicDate();
    const scopeClause = scope === 'overdue'
      ? 'F.planDate < ?'
      : scope === 'today'
        ? 'F.planDate = ?'
        : scope === 'upcoming'
          ? 'F.planDate > ?'
          : 'F.planDate IS NOT NULL';
    const params = scope === 'all'
      ? [...tenantParams(context.clinicId)]
      : [today, ...tenantParams(context.clinicId)];
    const tenantClause = tenantAnd(context.clinicId, 'F.clinicId');
    const baseWhere = `F.status IN ('PENDING', 'IN_PROGRESS')
         AND F.deletedAt IS NULL
         AND ${scopeClause}
         ${tenantClause}`;
    const totalRow = this.db.prepare(
      `SELECT COUNT(*) AS c FROM FollowUp F
       LEFT JOIN Patient P ON P.id = F.patientId
       WHERE ${baseWhere}`,
    ).get(...params) as { c: number };
    const total = Number(totalRow.c);
    const cap = Math.max(1, Math.min(50_000, Math.floor(Number(maxRows) || 50_000)));
    const headers: Array<{ key: string; label: string }> = [
      { key: 'id', label: 'id' },
      { key: 'patientName', label: '患者' },
      { key: 'patientPhone', label: '电话' },
      { key: 'planDate', label: '计划日期' },
      { key: 'status', label: '状态' },
      { key: 'content', label: '内容' },
      { key: 'completedAt', label: '完成时间' },
      { key: 'result', label: '结果' },
    ];
    const lines = [headers.map((header) => csvCell(header.label)).join(',')];
    const PAGE = 1000;
    let offset = 0;
    let included = 0;
    for (;;) {
      const rows = this.db.prepare(
        `SELECT F.id, P.name AS patientName, P.phone AS patientPhone,
                F.planDate, F.status, F.content, F.completedAt, F.result
         FROM FollowUp F
         LEFT JOIN Patient P ON P.id = F.patientId
         WHERE ${baseWhere}
         ORDER BY F.planDate ASC, P.name ASC
         LIMIT ? OFFSET ?`,
      ).all(...params, PAGE, offset) as Array<Record<string, unknown>>;
      if (rows.length === 0) break;
      for (const row of rows) {
        if (included >= cap) break;
        const masked: Record<string, unknown> = {
          ...row,
          patientPhone: maskPhoneForExport(row.patientPhone as string | null | undefined),
        };
        lines.push(headers.map((header) => csvCell(masked[header.key])).join(','));
        included += 1;
      }
      if (included >= cap || rows.length < PAGE) break;
      offset += rows.length;
    }
    if (included < total) lines.push('# truncated');
    return lines.join('\n');
  }

  async batchGenerate(limit = 50, context: AppContext): Promise<{ processed: number; generated: number }> {
    const maxLimit = Math.min(200, Math.max(1, Math.floor(Number(limit) || 50)));
    const tenantV = tenantWhere(context.clinicId, 'V.clinicId');
    const tenantTpl = tenantWhere(context.clinicId);
    const rowParams = [...tenantV.params, maxLimit];
    const rows = this.db.prepare(
      `SELECT DISTINCT V.patientId,
              COALESCE(T.completedDate, V.createdAt) AS completedAt
       FROM Visit V
       INNER JOIN Treatment T ON T.visitId = V.id
       WHERE V.status = 'COMPLETED'
         AND T.status = 'COMPLETED'
         AND V.deletedAt IS NULL
         AND T.deletedAt IS NULL
         ${tenantV.sql ? `AND ${tenantV.sql}` : ''}
       LIMIT ?`,
    ).all(...rowParams) as Array<{ patientId: string; completedAt: string }>;
    const templateParams = tenantTpl.params;
    const templates = this.db.prepare(
      `SELECT id, name, daysAfter, content, assigneeId
       FROM FollowUpTemplate
       WHERE isEnabled = 1 AND deletedAt IS NULL
         ${tenantTpl.sql ? `AND ${tenantTpl.sql}` : ''}
       ORDER BY daysAfter ASC
       LIMIT 20`,
    ).all(...templateParams) as Array<{ id: string; name: string; daysAfter: number; content: string | null; assigneeId: string | null }>;
    let generated = 0;
    const now = context.now().toISOString();
    const alreadyExists = (patientId: string, planDate: string, templateId: string | null): boolean => {
      const templateClause = templateId ? 'templateId = ?' : 'templateId IS NULL';
      const params = [patientId, planDate, ...(templateId ? [templateId] : []), ...tenantParams(context.clinicId)];
      return Boolean(this.db.prepare(
        `SELECT 1 FROM FollowUp
         WHERE patientId = ? AND planDate = ? AND ${templateClause}
           AND status IN ('PENDING', 'IN_PROGRESS')
           AND deletedAt IS NULL${tenantAnd(context.clinicId)}
         LIMIT 1`,
      ).get(...params));
    };
    const run = this.db.transaction(() => {
      for (const row of rows) {
        if (templates.length === 0) {
          const planDate = new SystemClock().clinicDate(Date.now() + 14 * 86_400_000);
          if (alreadyExists(row.patientId, planDate, null)) continue;
          this.followUpRepository.insert({
            id: randomUUID(),
            clinicId: context.clinicId ?? null,
            createdAt: now,
            updatedAt: now,
            patientId: row.patientId,
            planDate,
            content: '定期随访',
            status: 'PENDING',
          });
          generated += 1;
          continue;
        }
        /* v8 ignore start -- the query returns a non-null COALESCE value. */
        const completedAt = new Date(String(row.completedAt ?? Date.now())).getTime();
        /* v8 ignore stop */
        if (!Number.isFinite(completedAt)) throw new ValidationError('Completed date is invalid for follow-up generation');
        for (const template of templates) {
          const planDate = new SystemClock().clinicDate(completedAt + Number(template.daysAfter ?? 1) * 86_400_000);
          if (alreadyExists(row.patientId, planDate, template.id)) continue;
          this.followUpRepository.insert({
            id: randomUUID(),
            clinicId: context.clinicId ?? null,
            createdAt: now,
            updatedAt: now,
            patientId: row.patientId,
            planDate,
            content: template.content ?? template.name,
            status: 'PENDING',
            assigneeId: template.assigneeId ?? null,
            templateId: template.id,
          });
          generated += 1;
        }
      }
    });
    run();
    return { processed: rows.length, generated };
  }

  adherence(context: AppContext): { total: number; onTime: number; rate: number } {
    const params = tenantParams(context.clinicId);
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN strftime('%Y-%m-%d', completedAt, '+8 hours') <= planDate THEN 1 ELSE 0 END), 0) AS onTime
       FROM FollowUp
       WHERE status = 'COMPLETED' AND planDate IS NOT NULL AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(...params) as { total: number; onTime: number };
    /* v8 ignore start -- the aggregate query always returns numeric columns. */
    const total = Number(row.total ?? 0);
    const onTime = Number(row.onTime ?? 0);
    /* v8 ignore stop */
    return { total, onTime, rate: total === 0 ? 0 : Math.round((onTime / total) * 100) };
  }
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // CWE-1236：阻止公式注入（Excel 打开时执行 =SUM(...) 等）
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${guarded.replaceAll('"', '""')}"`;
}

/** 导出时掩码手机号：保留前 3 后 4，中间以 * 代替。 */
export function maskPhoneForExport(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 7) return phone.replace(/./g, '*');
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}
