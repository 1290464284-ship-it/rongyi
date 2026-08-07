import type Database from 'better-sqlite3';
import { NotFoundError } from '../../infrastructure/errors';
import { SqliteAnalyticsRepository } from '../../infrastructure/repositories/core.repositories';
import { tenantAnd, tenantParams } from '../../infrastructure/tenant';
import { escapeHtml } from '../../shared/html';
import type { AppContext } from '../../../domain/contracts';
import type { AnalyticsRepository } from '../ports';

export class AnalyticsService {
  private readonly db: Database.Database;
  private readonly analyticsRepository: AnalyticsRepository;

  constructor(db: Database.Database, analyticsRepository?: AnalyticsRepository) {
    this.db = db;
    this.analyticsRepository = analyticsRepository ?? new SqliteAnalyticsRepository(db);
  }

  rfm(context: AppContext): Array<Record<string, unknown>> {
    return this.analyticsRepository.rfm(context.clinicId);
  }

  churn(context: AppContext): Array<Record<string, unknown>> {
    return this.analyticsRepository.churn(context.clinicId);
  }

  doctorAnomalies(context: AppContext): Array<Record<string, unknown>> {
    return this.analyticsRepository.doctorAnomalies(context.clinicId);
  }

  clinicOverview(context: AppContext): Array<Record<string, unknown>> {
    return this.db.prepare(
      `WITH metrics AS (
         SELECT clinicId, 'patients' AS metric, COUNT(*) AS value
         FROM Patient WHERE deletedAt IS NULL GROUP BY clinicId
         UNION ALL
         SELECT clinicId, 'appointments', COUNT(*)
         FROM Appointment WHERE deletedAt IS NULL GROUP BY clinicId
         UNION ALL
         SELECT clinicId, 'charges', COUNT(*)
         FROM Charge WHERE deletedAt IS NULL GROUP BY clinicId
         UNION ALL
         SELECT clinicId, 'paidAmount', COALESCE(SUM(paidAmount - refundedAmount), 0)
         FROM Charge WHERE deletedAt IS NULL AND status <> 'CANCELLED' GROUP BY clinicId
         UNION ALL
         SELECT clinicId, 'unpaidAmount', COALESCE(SUM(CASE WHEN status IN ('UNPAID', 'PARTIAL') THEN totalAmount - paidAmount ELSE 0 END), 0)
         FROM Charge WHERE deletedAt IS NULL GROUP BY clinicId
         UNION ALL
         SELECT clinicId, 'inventoryItems', COUNT(*)
         FROM InventoryItem WHERE deletedAt IS NULL GROUP BY clinicId
         UNION ALL
         SELECT clinicId, 'pendingFollowUps', COUNT(*)
         FROM FollowUp WHERE deletedAt IS NULL AND status IN ('PENDING', 'IN_PROGRESS') GROUP BY clinicId
       )
       SELECT
         COALESCE(C.id, 'legacy') AS clinicId,
         COALESCE(C.name, 'Legacy') AS clinicName,
         COALESCE(SUM(CASE WHEN M.metric = 'patients' THEN M.value ELSE 0 END), 0) AS patients,
         COALESCE(SUM(CASE WHEN M.metric = 'appointments' THEN M.value ELSE 0 END), 0) AS appointments,
         COALESCE(SUM(CASE WHEN M.metric = 'charges' THEN M.value ELSE 0 END), 0) AS charges,
         COALESCE(SUM(CASE WHEN M.metric = 'paidAmount' THEN M.value ELSE 0 END), 0) AS paidAmount,
         COALESCE(SUM(CASE WHEN M.metric = 'unpaidAmount' THEN M.value ELSE 0 END), 0) AS unpaidAmount,
         COALESCE(SUM(CASE WHEN M.metric = 'inventoryItems' THEN M.value ELSE 0 END), 0) AS inventoryItems,
         COALESCE(SUM(CASE WHEN M.metric = 'pendingFollowUps' THEN M.value ELSE 0 END), 0) AS pendingFollowUps
       FROM (
         SELECT id, name FROM Clinic
         WHERE deletedAt IS NULL
           AND (id IN (SELECT clinicId FROM UserClinic WHERE userId = ? AND deletedAt IS NULL) OR id IS NULL)
         UNION ALL
         SELECT NULL, NULL
       ) C
       LEFT JOIN metrics M ON (C.id IS NULL AND M.clinicId IS NULL) OR M.clinicId = C.id
       GROUP BY C.id, C.name
       ORDER BY patients DESC, clinicName ASC`,
    ).all(context.userId) as Array<Record<string, unknown>>;
  }
}

export class ChargeAssistantService {
  constructor(private readonly db: Database.Database) {}

  frequentItems(context: AppContext): Array<Record<string, unknown>> {
    const tenantClause = tenantAnd(context.clinicId);
    const params: unknown[] = tenantParams(context.clinicId);
    return this.db.prepare(
      `SELECT category, name, COUNT(*) AS count
       FROM ChargeItem
       WHERE deletedAt IS NULL${tenantClause}
       GROUP BY category, name
       ORDER BY count DESC
       LIMIT 50`,
    ).all(...params) as Array<Record<string, unknown>>;
  }
}

export class PrintTemplateService {
  constructor(private readonly db: Database.Database) {}

  list(context: AppContext): Array<Record<string, unknown>> {
    const tenantClause = tenantAnd(context.clinicId);
    const params: unknown[] = tenantParams(context.clinicId);
    return this.db.prepare(
      `SELECT * FROM PrintTemplate WHERE deletedAt IS NULL${tenantClause} ORDER BY category, name`,
    ).all(...params) as Array<Record<string, unknown>>;
  }

  render(code: string, variables: Record<string, unknown>, context: AppContext): string {
    const params: unknown[] = [code, ...tenantParams(context.clinicId)];
    const row = this.db.prepare(`SELECT * FROM PrintTemplate WHERE code = ? AND deletedAt IS NULL${tenantAnd(context.clinicId)}`).get(...params) as
      | Record<string, unknown>
      | undefined;
    if (!row) throw new NotFoundError('Print template not found');
    // B-M7：模板正文原样输出（模板本身即 HTML，escapeHtml 会破坏排版），
    // 仅对插值变量值做转义，防止 {{name}} 等变量注入脚本。
    return Object.entries(variables).reduce(
      (html, [key, value]) => html.replaceAll(`{{${key}}}`, escapeHtml(String(value ?? ''))),
      String(row.content),
    );
  }
}
