// 经营分析仓储（M-04：由 core.repositories.ts 拆分）
import type Database from 'better-sqlite3';
import { tenantAnd } from '../tenant';
import type { AnalyticsRepository } from '../../application/ports';

export class SqliteAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly db: Database.Database) {}

  rfm(clinicId: string | null): { items: Array<Record<string, unknown>>; truncated: boolean } {
    const patientClause = tenantAnd(clinicId, 'P.clinicId');
    const chargeClause = tenantAnd(clinicId, 'C.clinicId');
    const params: unknown[] = clinicId ? [clinicId, clinicId] : [];
    const total = Number((this.db.prepare(
      `SELECT COUNT(*) AS total
       FROM Patient P
       WHERE P.deletedAt IS NULL${patientClause}`,
    ).get(...(clinicId ? [clinicId] : [])) as { total: number }).total);
    const items = this.db.prepare(
      `SELECT P.id AS patientId, P.name,
              COUNT(C.id) AS frequency,
              COALESCE(SUM(C.paidAmount - C.refundedAmount), 0) AS monetary,
              COALESCE(MAX(C.paidAt), P.createdAt) AS lastPaidAt
       FROM Patient P
       LEFT JOIN Charge C ON C.patientId = P.id AND C.deletedAt IS NULL AND C.paidAt IS NOT NULL${chargeClause}
       WHERE P.deletedAt IS NULL${patientClause}
       GROUP BY P.id, P.name
       ORDER BY monetary DESC
       LIMIT 200`,
    ).all(...params) as Array<Record<string, unknown>>;
    return { items, truncated: total > items.length };
  }

  churn(clinicId: string | null): { items: Array<Record<string, unknown>>; truncated: boolean } {
    const cutoff = new Date(Date.now() - 180 * 86_400_000).toISOString();
    const patientClause = tenantAnd(clinicId, 'P.clinicId');
    const visitClause = tenantAnd(clinicId, 'V.clinicId');
    const params: unknown[] = clinicId ? [clinicId, clinicId, cutoff] : [cutoff];
    const total = Number((this.db.prepare(
      `SELECT COUNT(*) AS total
       FROM (
         SELECT P.id
         FROM Patient P
         LEFT JOIN Visit V ON V.patientId = P.id AND V.deletedAt IS NULL${visitClause}
         WHERE P.deletedAt IS NULL${patientClause}
         GROUP BY P.id, P.name, P.phone
         HAVING COALESCE(MAX(V.createdAt), '1970-01-01T00:00:00.000Z') < ?
       ) AS churned`,
    ).get(...params) as { total: number }).total);
    const items = this.db.prepare(
      `SELECT P.id, P.name, P.phone,
              COALESCE(MAX(V.createdAt), '1970-01-01T00:00:00.000Z') AS lastVisitAt
       FROM Patient P
       LEFT JOIN Visit V ON V.patientId = P.id AND V.deletedAt IS NULL${visitClause}
       WHERE P.deletedAt IS NULL${patientClause}
       GROUP BY P.id, P.name, P.phone
       HAVING lastVisitAt < ?
       ORDER BY lastVisitAt ASC
       LIMIT 100`,
    ).all(...params) as Array<Record<string, unknown>>;
    return { items, truncated: total > items.length };
  }

  doctorAnomalies(clinicId: string | null): Array<Record<string, unknown>> {
    const userClause = tenantAnd(clinicId, 'U.clinicId');
    const chargeClause = tenantAnd(clinicId, 'C.clinicId');
    const params: unknown[] = clinicId ? [clinicId, clinicId] : [];
    return this.db.prepare(
      `SELECT U.id AS doctorId, U.name AS doctorName,
              COUNT(C.id) AS chargeCount,
              COALESCE(AVG(C.paidAmount - C.refundedAmount), 0) AS avgCharge
       FROM User U
       LEFT JOIN Charge C ON C.doctorId = U.id AND C.deletedAt IS NULL${chargeClause}
       WHERE U.role IN ('DOCTOR', 'BOSS')${userClause}
       GROUP BY U.id, U.name
       HAVING chargeCount > 0
       ORDER BY avgCharge DESC`,
    ).all(...params) as Array<Record<string, unknown>>;
  }
}
