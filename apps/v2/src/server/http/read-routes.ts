import type { Express } from 'express';
import type Database from 'better-sqlite3';
import type {
  PrintService,
  SatisfactionService,
  SearchService,
  StatsService,
} from '../application/services';
import { ValidationError } from '../infrastructure/errors';
import { tenantAnd, tenantParams } from '../infrastructure/tenant';
import { clinicTzOffsetSuffix } from '../infrastructure/clock';
import { buildRelationLabelJoins } from '../infrastructure/repository';
import { maskPhoneForExport } from '../application/service-modules/operations';
import { resourceRegistry } from '../../domain/resources';
import { wrapAsync } from './middleware';
import { createRateLimit } from './rate-limit';
import type { RateLimitStore } from './rate-limit';
import type {
  AnalyticsService,
  ChargeAssistantService,
  PrintTemplateService,
} from '../application/workflow-services';

export interface ReadRouteDependencies {
  db: Database.Database;
  analytics: AnalyticsService;
  chargeAssistant: ChargeAssistantService;
  printTemplates: PrintTemplateService;
  satisfaction: SatisfactionService;
  stats: StatsService;
  print: PrintService;
  search: SearchService;
  rateLimitStore?: RateLimitStore;
}

export function registerReadRoutes(app: Express, deps: ReadRouteDependencies): void {
  app.get('/api/v2/analytics/clinic-overview', wrapAsync(async (req, res) => {
      res.json({ success: true, data: deps.analytics.clinicOverview(req.context!) });
  }));

  app.get('/api/v2/analytics/rfm', wrapAsync(async (req, res) => {
      res.json({ success: true, data: deps.analytics.rfm(req.context!) });
  }));

  app.get('/api/v2/analytics/churn', wrapAsync(async (req, res) => {
      res.json({ success: true, data: deps.analytics.churn(req.context!) });
  }));

  app.get('/api/v2/analytics/doctor-anomalies', wrapAsync(async (req, res) => {
      res.json({ success: true, data: deps.analytics.doctorAnomalies(req.context!) });
  }));

  app.get('/api/v2/charge-assistant/frequent-items', wrapAsync(async (req, res) => {
      res.json({ success: true, data: deps.chargeAssistant.frequentItems(req.context!) });
  }));

  app.get('/api/v2/print/templates', wrapAsync(async (req, res) => {
      res.json({ success: true, data: deps.printTemplates.list(req.context!) });
  }));

  app.post('/api/v2/print/templates/:code/render', wrapAsync(async (req, res) => {
      res.type('html').send(deps.printTemplates.render(String(req.params.code), req.body ?? {}, req.context!));
  }));

  app.get('/api/v2/satisfaction/nps', wrapAsync(async (req, res) => {
      res.json({ success: true, data: deps.satisfaction.nps(req.context!) });
  }));

  app.get('/api/v2/satisfaction/trend', wrapAsync(async (req, res) => {
      res.json({ success: true, data: deps.satisfaction.trend(req.context!) });
  }));

  app.get('/api/v2/satisfaction/doctor-rankings', wrapAsync(async (req, res) => {
      res.json({ success: true, data: deps.satisfaction.doctorRankings(req.context!) });
  }));

  app.get('/api/v2/stats/dashboard', wrapAsync(async (req, res) => {
      res.json({ success: true, data: deps.stats.dashboard(req.context!) });
  }));

  app.get('/api/v2/stats/revenue', wrapAsync(async (req, res) => {
      const groupBy = req.query.groupBy === 'month' ? 'month' : 'day';
      res.json({
        success: true,
        data: deps.stats.revenue(
          typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
          typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
          groupBy,
          req.context!,
        ),
      });
  }));

  app.get('/api/v2/stats/patient-growth', wrapAsync(async (req, res) => {
      res.json({
        success: true,
        data: deps.stats.patientGrowth(
          typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
          typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
          req.context!,
        ),
      });
  }));

  app.get('/api/v2/stats/inventory', wrapAsync(async (req, res) => {
      res.json({ success: true, data: deps.stats.inventoryStats(req.context!) });
  }));

  app.get('/api/v2/stats/member-cards', wrapAsync(async (req, res) => {
      res.json({ success: true, data: deps.stats.memberStats(req.context!) });
  }));

  const PRINT_KINDS = ['report', 'analytics'] as const;

  app.get('/api/v2/print', wrapAsync(async (req, res) => {
      const kind = String(req.query.kind ?? 'report');
      if (!(PRINT_KINDS as readonly string[]).includes(kind)) {
        throw new ValidationError('unsupported print kind');
      }
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(req.query.data ?? '{}')) as Record<string, unknown>;
      } catch {
        throw new ValidationError('data must be valid JSON');
      }
      res.type('html').send(deps.print.render(kind, data));
  }));

  app.post('/api/v2/print', wrapAsync(async (req, res) => {
      const kind = String(req.body?.kind ?? 'report');
      if (!(PRINT_KINDS as readonly string[]).includes(kind)) {
        throw new ValidationError('unsupported print kind');
      }
      const rawData = req.body?.data;
      let data: Record<string, unknown>;
      if (rawData === undefined || rawData === null) {
        data = {};
      } else if (typeof rawData === 'object' && !Array.isArray(rawData)) {
        data = rawData as Record<string, unknown>;
      } else {
        throw new ValidationError('data must be an object');
      }
      res.type('html').send(deps.print.render(kind, data));
  }));

  app.get('/api/v2/appointments/by-date', wrapAsync(async (req, res) => {
      const date = String(req.query.date ?? '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        throw new ValidationError('date must be YYYY-MM-DD');
      }
      const tzSuffix = clinicTzOffsetSuffix();
      const start = new Date(`${date}T00:00:00${tzSuffix}`).toISOString();
      const end = new Date(`${date}T23:59:59.999${tzSuffix}`).toISOString();
      // 与通用 list 一致：relation 字段 LEFT JOIN 取 labelField（白名单元数据），供看板显示姓名而非 UUID。
      const labelJoins = buildRelationLabelJoins(resourceRegistry.get('appointments')!);
      const labelSelect = labelJoins.length > 0 ? `, ${labelJoins.map((join) => join.select).join(', ')}` : '';
      const labelJoinSql = labelJoins.map((join) => join.join).join(' ');
      const rows = deps.db.prepare(
        `SELECT t.*${labelSelect} FROM Appointment t ${labelJoinSql} WHERE t.startTime >= ? AND t.startTime <= ? AND t.deletedAt IS NULL${tenantAnd(req.context!.clinicId, 't.clinicId')} ORDER BY t.startTime ASC`,
      ).all(start, end, ...tenantParams(req.context!.clinicId)) as Array<Record<string, unknown>>;
      // 临时患者电话（tempPatientPhone）属敏感字段，直出接口需掩码，保持响应结构不变。
      const items = rows.map((row) => (
        typeof row.tempPatientPhone === 'string' && row.tempPatientPhone !== ''
          ? { ...row, tempPatientPhone: maskPhoneForExport(row.tempPatientPhone) }
          : row
      ));
      res.json({ success: true, data: { items, total: rows.length } });
  }));

  // 与其他限流器一致使用 DB 后端，多实例共享同一窗口。
  const searchLimiter = createRateLimit({ windowMs: 60_000, max: 300 }, deps.rateLimitStore);
  app.get('/api/v2/search', searchLimiter, wrapAsync(async (req, res) => {
      const q = String(req.query.q ?? '').trim();
      if (q.length < 2) {
        res.json({ success: true, data: [] });
        return;
      }
      if (q.length > 200) {
        throw new ValidationError('Search query must be at most 200 characters');
      }
      res.json({ success: true, data: deps.search.search(q, req.context!) });
  }));
}
