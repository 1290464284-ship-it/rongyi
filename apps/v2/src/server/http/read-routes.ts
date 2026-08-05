import type { Express } from 'express';
import type {
  PrintService,
  SatisfactionService,
  SearchService,
  StatsService,
} from '../application/services';
import { ValidationError } from '../infrastructure/errors';
import { wrapAsync } from './middleware';
import { createRateLimit } from './rate-limit';
import type {
  AnalyticsService,
  ChargeAssistantService,
  PrintTemplateService,
} from '../application/workflow-services';

export interface ReadRouteDependencies {
  analytics: AnalyticsService;
  chargeAssistant: ChargeAssistantService;
  printTemplates: PrintTemplateService;
  satisfaction: SatisfactionService;
  stats: StatsService;
  print: PrintService;
  search: SearchService;
}

export function registerReadRoutes(app: Express, deps: ReadRouteDependencies): void {
  app.get('/api/v2/analytics/clinic-overview', wrapAsync(async (req, res) => {
      res.json({ success: true, data: deps.analytics.clinicOverview() });
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

  app.get('/api/v2/print', wrapAsync(async (req, res) => {
      const kind = String(req.query.kind ?? 'report');
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(req.query.data ?? '{}')) as Record<string, unknown>;
      } catch {
        throw new ValidationError('data must be valid JSON');
      }
      res.type('html').send(deps.print.render(kind, data));
  }));

  const searchLimiter = createRateLimit({ windowMs: 60_000, max: 300 });
  app.get('/api/v2/search', searchLimiter, wrapAsync(async (req, res) => {
      const q = String(req.query.q ?? '').trim();
      if (q.length < 2) {
        res.json({ success: true, data: [] });
        return;
      }
      res.json({ success: true, data: deps.search.search(q, req.context!) });
  }));
}
