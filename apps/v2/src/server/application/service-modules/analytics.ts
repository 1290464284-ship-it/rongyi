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
    return Object.entries(variables).reduce(
      (html, [key, value]) => html.replaceAll(`{{${key}}}`, escapeHtml(String(value ?? ''))),
      escapeHtml(String(row.content)),
    );
  }
}
