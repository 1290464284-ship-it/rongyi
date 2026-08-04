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
    const ftsQuery = query.split(/\s+/)
      .filter(Boolean)
      .map((token) => `"${token.replace(/"/g, '""')}"*`)
      .join(' ');
    const clinicClause = tenantAnd(context.clinicId);
    const ftsParams = [ftsQuery, ...tenantParams(context.clinicId)];
    const matches = this.db.prepare(
      `SELECT resource, recordId
       FROM SearchIndex
       WHERE SearchIndex MATCH ?${clinicClause}
       LIMIT 500`,
    ).all(...ftsParams) as Array<{ resource: string; recordId: string }>;
    const idsByResource = new Map<string, string[]>();
    for (const match of matches) {
      const key = searchResourceName(match.resource);
      const ids = idsByResource.get(key) ?? [];
      ids.push(match.recordId);
      idsByResource.set(key, ids);
    }

    const results: Array<Record<string, unknown>> = [];
    const searches: Array<{
      resource: string;
      rows: Array<Record<string, unknown>>;
      label: (row: Record<string, unknown>) => string;
    }> = [
      {
        resource: 'patients',
        rows: this.rowsByIds('patients', 'SELECT id, name, phone, code FROM Patient', 'deletedAt IS NULL', idsByResource, context),
        label: (row) => String(row.name ?? row.code ?? ''),
      },
      {
        resource: 'appointments',
        rows: this.rowsByIds(
          'appointments',
          `SELECT A.id, P.name AS patientName, A.startTime, A.status
           FROM Appointment A
           LEFT JOIN Patient P ON P.id = A.patientId`,
          'A.deletedAt IS NULL AND P.deletedAt IS NULL',
          idsByResource,
          context,
          'A.clinicId',
          'A.id',
        ),
        label: (row) => String(row.patientName ?? ''),
      },
      {
        resource: 'charges',
        rows: this.rowsByIds(
          'charges',
          `SELECT C.id, P.name AS patientName, C.number, C.status
           FROM Charge C
           LEFT JOIN Patient P ON P.id = C.patientId`,
          'C.deletedAt IS NULL AND P.deletedAt IS NULL',
          idsByResource,
          context,
          'C.clinicId',
          'C.id',
        ),
        label: (row) => String(row.number ?? ''),
      },
      {
        resource: 'inventoryItems',
        rows: this.rowsByIds('inventoryItems', 'SELECT id, name, code, category, stock FROM InventoryItem', 'deletedAt IS NULL', idsByResource, context),
        label: (row) => String(row.name ?? row.code ?? ''),
      },
      {
        resource: 'suppliers',
        rows: this.rowsByIds('suppliers', 'SELECT id, name, code, phone FROM Supplier', 'deletedAt IS NULL', idsByResource, context),
        label: (row) => String(row.name ?? ''),
      },
      {
        resource: 'followUps',
        rows: this.rowsByIds(
          'followUps',
          `SELECT F.id, P.name AS patientName, P.phone AS phone, F.content, F.status
           FROM FollowUp F
           LEFT JOIN Patient P ON P.id = F.patientId`,
          'F.deletedAt IS NULL AND P.deletedAt IS NULL',
          idsByResource,
          context,
          'F.clinicId',
          'F.id',
        ),
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

  private rowsByIds(
    resource: string,
    selectFrom: string,
    whereBase: string,
    idsByResource: Map<string, string[]>,
    context: AppContext,
    tenantColumn = 'clinicId',
    idColumn = 'id',
  ): Array<Record<string, unknown>> {
    const ids = idsByResource.get(resource) ?? [];
    if (ids.length === 0) return [];
    const placeholders = ids.map(() => '?').join(', ');
    const sql = `${selectFrom} WHERE ${whereBase} AND ${idColumn} IN (${placeholders})${tenantAnd(context.clinicId, tenantColumn)}`;
    return this.db.prepare(sql).all(...ids, ...tenantParams(context.clinicId)) as Array<Record<string, unknown>>;
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

function searchResourceName(resource: string): string {
  switch (resource) {
    case 'Patient':
      return 'patients';
    case 'Appointment':
      return 'appointments';
    case 'Charge':
      return 'charges';
    case 'InventoryItem':
      return 'inventoryItems';
    case 'Supplier':
      return 'suppliers';
    case 'FollowUp':
      return 'followUps';
    default:
      return resource;
  }
}
