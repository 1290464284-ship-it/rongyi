import type Database from 'better-sqlite3';
import { ConflictError, NotFoundError, ValidationError } from '../../infrastructure/errors';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { trackResourceWrite } from '../../infrastructure/write-tracking';
import { computeNps, computeAverage } from '../nps';
import type { AppContext } from '../../../domain/contracts';

const EXECUTION_STATUSES = new Set(['DONE', 'SKIPPED']);

function normalizeOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function validateRating(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10) {
    throw new ValidationError('评分必须在 0-10 之间');
  }
  return value;
}

export class FollowUpExecutionService {
  constructor(private readonly db: Database.Database) {}

  execute(
    id: string,
    input: {
      executionStatus: string;
      patientRating?: number;
      painLevel?: number;
      feedback?: string;
      contactedAt?: string;
      nextPlanDate?: string;
    },
    context: AppContext,
  ): Record<string, unknown> {
    const row = this.db.prepare(
      `SELECT id, executionStatus FROM FollowUp
       WHERE id = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`,
    ).get(id, ...tenantParams(context.clinicId)) as { id: string; executionStatus: string | null } | undefined;
    if (!row) throw new NotFoundError('FollowUp not found');
    if ((row.executionStatus ?? 'PENDING') !== 'PENDING') {
      throw new ConflictError('该随访已完成执行');
    }

    const executionStatus = input.executionStatus;
    if (typeof executionStatus !== 'string' || !EXECUTION_STATUSES.has(executionStatus)) {
      throw new ValidationError('执行状态无效');
    }
    const patientRating = validateRating(input.patientRating);
    const painLevel = validateRating(input.painLevel);
    const feedback = normalizeOptionalString(input.feedback);
    const contactedAt = normalizeOptionalString(input.contactedAt);
    const nextPlanDate = normalizeOptionalString(input.nextPlanDate);
    if (executionStatus === 'DONE' && !contactedAt) {
      throw new ValidationError('请填写联系时间');
    }

    const now = context.now().toISOString();
    this.db.prepare(
      `UPDATE FollowUp
       SET executionStatus = ?, patientRating = ?, painLevel = ?, feedback = ?,
            contactedAt = ?, nextPlanDate = ?, status = 'COMPLETED', completedAt = ?, updatedAt = ?
       WHERE id = ?${tenantAnd(context.clinicId)}`,
    ).run(
       executionStatus, patientRating, painLevel, feedback, contactedAt, nextPlanDate, now, now, id,
       ...tenantParams(context.clinicId),
    );
    trackResourceWrite(this.db, { tableName: 'FollowUp', recordId: id, operation: 'UPDATE', clinicId: context.clinicId ?? null });
    return { id, executionStatus, patientRating, painLevel, nextPlanDate };
  }

  nps(context: AppContext): Record<string, unknown> {
    const rows = this.db.prepare(
      `SELECT patientRating, COUNT(*) AS count
       FROM FollowUp
       WHERE deletedAt IS NULL AND patientRating IS NOT NULL${tenantAnd(context.clinicId)}
       GROUP BY patientRating`,
    ).all(...tenantParams(context.clinicId)) as Array<{ patientRating: number; count: number }>;
    let total = 0;
    let promoters = 0;
    let passives = 0;
    let detractors = 0;
    let ratingSum = 0;
    const breakdown: Array<{ rating: number; count: number }> = [];
    for (const row of rows) {
      const rating = Number(row.patientRating);
      const count = Number(row.count);
      total += count;
      ratingSum += rating * count;
      if (rating === 9 || rating === 10) promoters += count;
      else if (rating === 7 || rating === 8) passives += count;
      else detractors += count;
      breakdown.push({ rating, count });
    }
    breakdown.sort((a, b) => a.rating - b.rating);
    const nps = computeNps(promoters, detractors, total);
    const average = computeAverage(ratingSum, total);
    return { total, promoters, passives, detractors, nps, average, breakdown };
  }
}
