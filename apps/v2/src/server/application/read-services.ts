import type Database from 'better-sqlite3';
import type { AppContext } from '../../domain/contracts';
import { escapeHtml } from '../shared/html';
import { tenantAnd, tenantParams, tenantWhere } from '../infrastructure/tenant';

export class StatsService {
  constructor(private readonly db: Database.Database) {}

  dashboard(context: AppContext): Record<string, unknown> {
    const clinic = context.clinicId;
    const tenant = tenantWhere(clinic);
    const withClinic = (sql: string): string => tenant.sql ? sql.replace('{clinic}', `${tenant.sql} AND `) : sql.replace('{clinic}', '');
    const param = tenant.params;
    const patientCount = (this.db.prepare(withClinic('SELECT COUNT(*) AS c FROM Patient WHERE {clinic}deletedAt IS NULL')).get(...param) as { c: number }).c;
    const appointmentCount = (this.db.prepare(withClinic('SELECT COUNT(*) AS c FROM Appointment WHERE {clinic}deletedAt IS NULL')).get(...param) as { c: number }).c;
    const chargeRow = this.db.prepare(withClinic(`
      SELECT COALESCE(SUM(CASE WHEN status <> 'CANCELLED' THEN paidAmount - refundedAmount ELSE 0 END), 0) AS paid,
             COALESCE(SUM(CASE WHEN status IN ('UNPAID', 'PARTIAL') THEN totalAmount - paidAmount ELSE 0 END), 0) AS unpaid
      FROM Charge WHERE {clinic}deletedAt IS NULL
    `)).get(...param) as { paid: number; unpaid: number };
    const inventoryCount = (this.db.prepare(withClinic('SELECT COUNT(*) AS c FROM InventoryItem WHERE {clinic}deletedAt IS NULL')).get(...param) as { c: number }).c;
    const followUpCount = (this.db.prepare(withClinic("SELECT COUNT(*) AS c FROM FollowUp WHERE {clinic}deletedAt IS NULL AND status = 'PENDING'")).get(...param) as { c: number }).c;
    return {
      patients: patientCount,
      appointments: appointmentCount,
      paidAmount: chargeRow.paid,
      unpaidAmount: chargeRow.unpaid,
      inventoryItems: inventoryCount,
      pendingFollowUps: followUpCount,
    };
  }

  revenue(
    startDate?: string,
    endDate?: string,
    groupBy: 'day' | 'month' = 'day',
    context?: AppContext,
  ): Array<Record<string, unknown>> {
    const groupExpr = groupBy === 'month'
      ? "substr(paidAt, 1, 7)"
      : "substr(paidAt, 1, 10)";
    const where: string[] = ['deletedAt IS NULL', 'paidAt IS NOT NULL'];
    const params: unknown[] = [];
    if (startDate) {
      where.push('paidAt >= ?');
      params.push(startDate);
    }
    if (endDate) {
      where.push('paidAt <= ?');
      params.push(endDate);
    }
    const tenant = tenantWhere(context?.clinicId);
    if (tenant.sql) {
      where.push(tenant.sql);
      params.push(...tenant.params);
    }
    return this.db.prepare(
      `SELECT ${groupExpr} AS period, SUM(CASE WHEN status <> 'CANCELLED' THEN paidAmount - refundedAmount ELSE 0 END) AS amount, COUNT(*) AS count
       FROM Charge
       WHERE ${where.join(' AND ')}
       GROUP BY ${groupExpr}
       ORDER BY period ASC`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  patientGrowth(startDate?: string, endDate?: string, context?: AppContext): Array<Record<string, unknown>> {
    const where: string[] = ['deletedAt IS NULL'];
    const params: unknown[] = [];
    if (startDate) {
      where.push('createdAt >= ?');
      params.push(startDate);
    }
    if (endDate) {
      where.push('createdAt <= ?');
      params.push(endDate);
    }
    const tenant = tenantWhere(context?.clinicId);
    if (tenant.sql) {
      where.push(tenant.sql);
      params.push(...tenant.params);
    }
    return this.db.prepare(
      `SELECT substr(createdAt, 1, 10) AS day, COUNT(*) AS count
       FROM Patient
       WHERE ${where.join(' AND ')}
       GROUP BY substr(createdAt, 1, 10)
       ORDER BY day ASC`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  doctorWorkload(context: AppContext): Array<Record<string, unknown>> {
    const userClause = tenantAnd(context.clinicId, 'U.clinicId');
    const visitJoin = tenantAnd(context.clinicId, 'V.clinicId');
    const chargeJoin = tenantAnd(context.clinicId, 'C.clinicId');
    const params: unknown[] = context.clinicId ? [context.clinicId, context.clinicId, context.clinicId] : [];
    return this.db.prepare(
      `SELECT U.id AS doctorId, U.name AS doctorName,
              COUNT(DISTINCT V.id) AS visits,
              COUNT(DISTINCT C.id) AS charges,
              COALESCE(SUM(C.paidAmount - C.refundedAmount), 0) AS paidAmount
       FROM User U
       LEFT JOIN Visit V ON V.doctorId = U.id AND V.deletedAt IS NULL${visitJoin}
       LEFT JOIN Charge C ON C.doctorId = U.id AND C.deletedAt IS NULL${chargeJoin}
       WHERE U.role IN ('DOCTOR', 'BOSS')${userClause}
       GROUP BY U.id, U.name
       ORDER BY paidAmount DESC`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  inventoryStats(context: AppContext): Array<Record<string, unknown>> {
    const tenant = tenantWhere(context.clinicId);
    const params: unknown[] = tenant.params;
    return this.db.prepare(
      `SELECT category, COUNT(*) AS count, SUM(stock) AS totalStock, SUM(minStock) AS minStock
       FROM InventoryItem
       WHERE deletedAt IS NULL ${tenant.sql ? `AND ${tenant.sql}` : ''}
       GROUP BY category
       ORDER BY category`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  memberStats(context: AppContext): Record<string, unknown> {
    const tenant = tenantWhere(context.clinicId);
    const clinicClause = tenant.sql ? `WHERE ${tenant.sql}` : '';
    const params: unknown[] = tenant.params;
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'ACTIVE' THEN 1 ELSE 0 END), 0) AS active,
              COALESCE(SUM(balance), 0) AS totalBalance,
              COALESCE(SUM(points), 0) AS totalPoints
       FROM MemberCard ${clinicClause}`,
    ).get(...params) as Record<string, unknown>;
    return row;
  }
}

export class PrintService {
  render(kind: string, data: Record<string, unknown>): string {
    const title = String(data.title ?? kind);
    const lines = Object.entries(data)
      .filter(([key]) => key !== 'title')
      .map(([key, value]) => `<p><strong>${escapeHtml(key)}</strong>: ${escapeHtml(String(value))}</p>`)
      .join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1>${lines}</body></html>`;
  }
}

export class SearchService {
  constructor(private readonly db: Database.Database) {}

  search(query: string, context: AppContext): Array<Record<string, unknown>> {
    const term = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
    const clinicClause = tenantAnd(context.clinicId);
    const appointmentClause = tenantAnd(context.clinicId, 'A.clinicId');
    const chargeClause = tenantAnd(context.clinicId, 'C.clinicId');
    const followUpClause = tenantAnd(context.clinicId, 'F.clinicId');
    const clinicParams: unknown[] = tenantParams(context.clinicId);
    const results: Array<Record<string, unknown>> = [];
    const searches: Array<{ resource: string; rows: Array<Record<string, unknown>>; label: (row: Record<string, unknown>) => string }> = [
      {
        resource: 'patients',
        rows: this.db.prepare(
          `SELECT id, name, phone, code FROM Patient
           WHERE deletedAt IS NULL AND (name LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\') ${clinicClause}
           LIMIT 20`,
        ).all(term, term, term, ...clinicParams) as Array<Record<string, unknown>>,
        label: (row) => String(row.name ?? row.code ?? ''),
      },
      {
        resource: 'appointments',
        rows: this.db.prepare(
          `SELECT A.id, P.name AS patientName, A.startTime, A.status
           FROM Appointment A
           LEFT JOIN Patient P ON P.id = A.patientId
           WHERE A.deletedAt IS NULL AND P.deletedAt IS NULL
             AND (P.name LIKE ? ESCAPE '\\' OR A.startTime LIKE ? ESCAPE '\\' OR A.status LIKE ? ESCAPE '\\') ${appointmentClause}
           LIMIT 20`,
        ).all(term, term, term, ...clinicParams) as Array<Record<string, unknown>>,
        label: (row) => String(row.patientName ?? ''),
      },
      {
        resource: 'charges',
        rows: this.db.prepare(
          `SELECT C.id, P.name AS patientName, C.number, C.status
           FROM Charge C
           LEFT JOIN Patient P ON P.id = C.patientId
           WHERE C.deletedAt IS NULL AND P.deletedAt IS NULL
             AND (C.number LIKE ? ESCAPE '\\' OR P.name LIKE ? ESCAPE '\\' OR C.status LIKE ? ESCAPE '\\') ${chargeClause}
           LIMIT 20`,
        ).all(term, term, term, ...clinicParams) as Array<Record<string, unknown>>,
        label: (row) => String(row.number ?? ''),
      },
      {
        resource: 'inventoryItems',
        rows: this.db.prepare(
          `SELECT id, name, code, category, stock FROM InventoryItem
           WHERE deletedAt IS NULL AND (name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR category LIKE ? ESCAPE '\\') ${clinicClause}
           LIMIT 20`,
        ).all(term, term, term, ...clinicParams) as Array<Record<string, unknown>>,
        label: (row) => String(row.name ?? row.code ?? ''),
      },
      {
        resource: 'suppliers',
        rows: this.db.prepare(
          `SELECT id, name, code, phone FROM Supplier
           WHERE deletedAt IS NULL AND (name LIKE ? ESCAPE '\\' OR code LIKE ? ESCAPE '\\' OR phone LIKE ? ESCAPE '\\') ${clinicClause}
           LIMIT 20`,
        ).all(term, term, term, ...clinicParams) as Array<Record<string, unknown>>,
        label: (row) => String(row.name ?? ''),
      },
      {
        resource: 'followUps',
        rows: this.db.prepare(
          `SELECT F.id, P.name AS patientName, P.phone AS phone, F.content, F.status
           FROM FollowUp F
           LEFT JOIN Patient P ON P.id = F.patientId
           WHERE F.deletedAt IS NULL AND P.deletedAt IS NULL
             AND (P.name LIKE ? ESCAPE '\\' OR F.content LIKE ? ESCAPE '\\' OR F.status LIKE ? ESCAPE '\\') ${followUpClause}
           LIMIT 20`,
        ).all(term, term, term, ...clinicParams) as Array<Record<string, unknown>>,
        label: (row) => String(row.patientName ?? ''),
      },
    ];

    for (const search of searches) {
      for (const row of search.rows) {
        const maskedPhone = row.phone ? this.maskPhone(String(row.phone)) : undefined;
        results.push({
          resource: search.resource,
          id: row.id,
          label: search.label(row),
          detail: { ...row, phone: maskedPhone ?? row.phone },
        });
      }
    }
    return results;
  }

  private maskPhone(phone: string): string {
    if (phone.length < 7) return '****';
    return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
  }
}

export class SatisfactionService {
  constructor(private readonly db: Database.Database) {}

  nps(context: AppContext): { promoters: number; detractors: number; passive: number; score: number } {
    const tenantClause = tenantAnd(context.clinicId);
    const params: unknown[] = tenantParams(context.clinicId);
    const rows = this.db.prepare(`SELECT score FROM SatisfactionSurvey WHERE deletedAt IS NULL${tenantClause}`).all(...params) as Array<{ score: number }>;
    if (rows.length === 0) return { promoters: 0, detractors: 0, passive: 0, score: 0 };
    const promoters = rows.filter((row) => row.score >= 9).length;
    const detractors = rows.filter((row) => row.score <= 6).length;
    const passive = rows.length - promoters - detractors;
    return { promoters, detractors, passive, score: Math.round(((promoters - detractors) / rows.length) * 100) };
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
