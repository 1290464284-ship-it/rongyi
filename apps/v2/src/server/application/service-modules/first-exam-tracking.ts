/**
 * 首诊追踪/流失登记服务。
 *
 * 管理 FirstExam 的 followUpStatus（待跟进/需横向转诊/横向已转/流失）及
 * 流失原因、下次跟进日期、追踪备注，并提供按租户聚合的追踪概览统计。
 */
import type Database from 'better-sqlite3';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import { SystemClock } from '../../infrastructure/clock';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import type { AppContext } from '../../../domain/contracts';

const FOLLOW_UP_STATUSES: readonly string[] = [
  'NONE',
  'PENDING',
  'HORIZONTAL_SHOULD',
  'HORIZONTAL_DONE',
  'LOST',
];

export interface UpdateTrackingInput {
  followUpStatus: string;
  lossReasonType?: string;
  lossReason?: string;
  nextFollowUpAt?: string;
  trackingNote?: string;
}

export class FirstExamTrackingService {
  constructor(private readonly db: Database.Database) {}

  updateTracking(id: string, input: UpdateTrackingInput, context: AppContext): Record<string, unknown> {
    const clinicId = context.clinicId;
    const existing = this.db.prepare(
      `SELECT id FROM FirstExam WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).get(id, ...tenantParams(clinicId));
    if (!existing) throw new NotFoundError('FirstExam not found');

    const followUpStatus = String(input?.followUpStatus ?? '');
    if (!FOLLOW_UP_STATUSES.includes(followUpStatus)) {
      throw new ValidationError('Invalid followUpStatus');
    }
    if (followUpStatus === 'LOST' && !input.lossReasonType) {
      throw new ValidationError('流失原因类型不能为空');
    }
    if ((followUpStatus === 'PENDING' || followUpStatus === 'HORIZONTAL_SHOULD') && !input.nextFollowUpAt) {
      throw new ValidationError('请填写下次跟进日期');
    }

    const now = context.now().toISOString();
    const result = this.db.prepare(
      `UPDATE FirstExam
       SET followUpStatus = ?, lossReasonType = ?, lossReason = ?, nextFollowUpAt = ?, trackingNote = ?, updatedAt = ?
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(clinicId)}`,
    ).run(
      followUpStatus,
      input.lossReasonType ?? null,
      input.lossReason ?? null,
      input.nextFollowUpAt ?? null,
      input.trackingNote ?? null,
      now,
      id,
      ...tenantParams(clinicId),
    );
    if (Number(result.changes) === 0) throw new NotFoundError('FirstExam not found');
    return { id, followUpStatus, nextFollowUpAt: input.nextFollowUpAt ?? null };
  }

  overview(context: AppContext): Record<string, unknown> {
    const clinicId = context.clinicId;
    const rows = this.db.prepare(
      `SELECT COALESCE(followUpStatus, 'NONE') AS followUpStatus, COUNT(*) AS count
       FROM FirstExam
       WHERE deletedAt IS NULL${tenantAnd(clinicId)}
       GROUP BY COALESCE(followUpStatus, 'NONE')`,
    ).all(...tenantParams(clinicId)) as Array<{ followUpStatus: string; count: number }>;

    const counts: Record<string, number> = {
      NONE: 0,
      PENDING: 0,
      HORIZONTAL_SHOULD: 0,
      HORIZONTAL_DONE: 0,
      LOST: 0,
    };
    for (const row of rows) {
      counts[row.followUpStatus] = Number(row.count ?? 0);
    }

    const today = new SystemClock().clinicDate(context.now());
    const dueRow = this.db.prepare(
      `SELECT COUNT(*) AS count FROM FirstExam
       WHERE deletedAt IS NULL
         AND followUpStatus IN ('PENDING', 'HORIZONTAL_SHOULD')
         AND nextFollowUpAt LIKE ?${tenantAnd(clinicId)}`,
    ).get(`${today}%`, ...tenantParams(clinicId)) as { count: number } | undefined;

    const total = rows.reduce((sum, row) => sum + Number(row.count ?? 0), 0);
    return { ...counts, total, dueToday: Number(dueRow?.count ?? 0) };
  }
}
