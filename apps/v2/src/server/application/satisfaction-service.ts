// 满意度服务（M-04：由 read-services.ts 拆分）
import type Database from 'better-sqlite3';
import type { AppContext } from '../../domain/contracts';
import { tenantAnd, tenantParams } from '../infrastructure/tenant';
import { computeNps } from './nps';

export class SatisfactionService {
  constructor(private readonly db: Database.Database) {}

  nps(context: AppContext): { promoters: number; detractors: number; passive: number; score: number } {
    const tenantClause = tenantAnd(context.clinicId);
    const params: unknown[] = tenantParams(context.clinicId);
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN score >= 9 THEN 1 ELSE 0 END), 0) AS promoters,
              COALESCE(SUM(CASE WHEN score <= 6 THEN 1 ELSE 0 END), 0) AS detractors,
              COALESCE(SUM(CASE WHEN score >= 7 AND score <= 8 THEN 1 ELSE 0 END), 0) AS passive
       FROM SatisfactionSurvey WHERE deletedAt IS NULL${tenantClause}`,
    ).get(...params) as { total: number; promoters: number; detractors: number; passive: number };
    const total = Number(row.total);
    const promoters = Number(row.promoters);
    const detractors = Number(row.detractors);
    const passive = Number(row.passive);
    return { promoters, detractors, passive, score: computeNps(promoters, detractors, total) };
  }

  trend(context: AppContext): Array<Record<string, unknown>> {
    const tenantClause = tenantAnd(context.clinicId);
    const params: unknown[] = tenantParams(context.clinicId);
    return this.db.prepare(
      `SELECT surveyDate, AVG(score) AS avgScore, COUNT(*) AS count
       FROM SatisfactionSurvey
       WHERE deletedAt IS NULL${tenantClause}
       GROUP BY surveyDate
       ORDER BY surveyDate ASC`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  doctorRankings(context: AppContext): Array<Record<string, unknown>> {
    const clinicClause = tenantAnd(context.clinicId, 'S.clinicId');
    const params: unknown[] = tenantParams(context.clinicId);
    return this.db.prepare(
      `SELECT S.doctorId, COALESCE(U.name, 'Unknown') AS doctorName,
              COUNT(*) AS surveyCount,
              ROUND(AVG(S.score), 1) AS avgScore
       FROM SatisfactionSurvey S
       LEFT JOIN User U ON U.id = S.doctorId
       WHERE S.deletedAt IS NULL ${clinicClause}
       GROUP BY S.doctorId, U.name
       ORDER BY avgScore DESC
       LIMIT 50`,
    ).all(...params) as Array<Record<string, unknown>>;
  }
}
