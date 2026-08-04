import type Database from 'better-sqlite3';
import type { AppContext } from '../../domain/contracts';

export class StatsService {
  constructor(private readonly db: Database.Database) {}

  dashboard(context: AppContext): Record<string, unknown> {
    const clinic = context.clinicId;
    const withClinic = (sql: string): string => clinic ? sql.replace('{clinic}', 'clinicId = ? AND ') : sql.replace('{clinic}', '');
    const param = clinic ? [clinic] : [];
    const patientCount = (this.db.prepare(withClinic('SELECT COUNT(*) AS c FROM Patient WHERE {clinic}deletedAt IS NULL')).get(...param) as { c: number }).c;
    const appointmentCount = (this.db.prepare(withClinic('SELECT COUNT(*) AS c FROM Appointment WHERE {clinic}deletedAt IS NULL')).get(...param) as { c: number }).c;
    const chargeRow = this.db.prepare(withClinic('SELECT COALESCE(SUM(paidAmount), 0) AS paid, COALESCE(SUM(totalAmount - paidAmount), 0) AS unpaid FROM Charge WHERE {clinic}deletedAt IS NULL')).get(...param) as { paid: number; unpaid: number };
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
    if (context?.clinicId) {
      where.push('clinicId = ?');
      params.push(context.clinicId);
    }
    return this.db.prepare(
      `SELECT ${groupExpr} AS period, SUM(paidAmount) AS amount, COUNT(*) AS count
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
    if (context?.clinicId) {
      where.push('clinicId = ?');
      params.push(context.clinicId);
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
    const clinicClause = context.clinicId
      ? 'AND U.clinicId = ? AND V.clinicId = ? AND C.clinicId = ?'
      : '';
    const params: unknown[] = context.clinicId ? [context.clinicId, context.clinicId, context.clinicId] : [];
    return this.db.prepare(
      `SELECT U.id AS doctorId, U.name AS doctorName,
              COUNT(DISTINCT V.id) AS visits,
              COUNT(DISTINCT C.id) AS charges,
              COALESCE(SUM(C.paidAmount), 0) AS paidAmount
       FROM User U
       LEFT JOIN Visit V ON V.doctorId = U.id AND V.deletedAt IS NULL
       LEFT JOIN Charge C ON C.doctorId = U.id AND C.deletedAt IS NULL
       WHERE U.role IN ('DOCTOR', 'BOSS') ${clinicClause}
       GROUP BY U.id, U.name
       ORDER BY paidAmount DESC`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  inventoryStats(context: AppContext): Array<Record<string, unknown>> {
    const clinicClause = context.clinicId ? 'AND clinicId = ?' : '';
    const params: unknown[] = context.clinicId ? [context.clinicId] : [];
    return this.db.prepare(
      `SELECT category, COUNT(*) AS count, SUM(stock) AS totalStock, SUM(minStock) AS minStock
       FROM InventoryItem
       WHERE deletedAt IS NULL ${clinicClause}
       GROUP BY category
       ORDER BY category`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  memberStats(context: AppContext): Record<string, unknown> {
    const clinicClause = context.clinicId ? 'WHERE clinicId = ?' : '';
    const params: unknown[] = context.clinicId ? [context.clinicId] : [];
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
    const term = `%${query}%`;
    const clinicClause = context.clinicId ? 'AND clinicId = ?' : '';
    const appointmentClause = context.clinicId ? 'AND A.clinicId = ?' : '';
    const chargeClause = context.clinicId ? 'AND C.clinicId = ?' : '';
    const followUpClause = context.clinicId ? 'AND F.clinicId = ?' : '';
    const clinicParams: unknown[] = context.clinicId ? [context.clinicId] : [];
    const results: Array<Record<string, unknown>> = [];
    const searches: Array<{ resource: string; rows: Array<Record<string, unknown>>; label: (row: Record<string, unknown>) => string }> = [
      {
        resource: 'patients',
        rows: this.db.prepare(
          `SELECT id, name, phone, code FROM Patient
           WHERE deletedAt IS NULL AND (name LIKE ? OR phone LIKE ? OR code LIKE ?) ${clinicClause}
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
             AND (P.name LIKE ? OR A.startTime LIKE ? OR A.status LIKE ?) ${appointmentClause}
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
             AND (C.number LIKE ? OR P.name LIKE ? OR C.status LIKE ?) ${chargeClause}
           LIMIT 20`,
        ).all(term, term, term, ...clinicParams) as Array<Record<string, unknown>>,
        label: (row) => String(row.number ?? ''),
      },
      {
        resource: 'inventoryItems',
        rows: this.db.prepare(
          `SELECT id, name, code, category, stock FROM InventoryItem
           WHERE deletedAt IS NULL AND (name LIKE ? OR code LIKE ? OR category LIKE ?) ${clinicClause}
           LIMIT 20`,
        ).all(term, term, term, ...clinicParams) as Array<Record<string, unknown>>,
        label: (row) => String(row.name ?? row.code ?? ''),
      },
      {
        resource: 'suppliers',
        rows: this.db.prepare(
          `SELECT id, name, code, phone FROM Supplier
           WHERE deletedAt IS NULL AND (name LIKE ? OR code LIKE ? OR phone LIKE ?) ${clinicClause}
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
             AND (P.name LIKE ? OR F.content LIKE ? OR F.status LIKE ?) ${followUpClause}
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
    const where = context.clinicId ? 'WHERE clinicId = ?' : '';
    const params: unknown[] = context.clinicId ? [context.clinicId] : [];
    const rows = this.db.prepare(`SELECT score FROM SatisfactionSurvey ${where}`).all(...params) as Array<{ score: number }>;
    if (rows.length === 0) return { promoters: 0, detractors: 0, passive: 0, score: 0 };
    const promoters = rows.filter((row) => row.score >= 9).length;
    const detractors = rows.filter((row) => row.score <= 6).length;
    const passive = rows.length - promoters - detractors;
    return { promoters, detractors, passive, score: Math.round(((promoters - detractors) / rows.length) * 100) };
  }

  trend(context: AppContext): Array<Record<string, unknown>> {
    const where = context.clinicId ? 'WHERE clinicId = ?' : '';
    const params: unknown[] = context.clinicId ? [context.clinicId] : [];
    return this.db.prepare(
      `SELECT surveyDate, AVG(score) AS avgScore, COUNT(*) AS count
       FROM SatisfactionSurvey
       ${where}
       GROUP BY surveyDate
       ORDER BY surveyDate ASC`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  doctorRankings(context: AppContext): Array<Record<string, unknown>> {
    const clinicClause = context.clinicId ? 'AND S.clinicId = ?' : '';
    const params: unknown[] = context.clinicId ? [context.clinicId] : [];
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
