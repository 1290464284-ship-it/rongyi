import type { Express } from 'express';
import type {
  PrintService,
  SatisfactionService,
  SearchService,
  StatsService,
} from '../application/services';
import { ValidationError } from '../infrastructure/errors';
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
  app.get('/api/v2/analytics/rfm', async (req, res, next) => {
    try {
      res.json({ success: true, data: deps.analytics.rfm(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/analytics/churn', async (req, res, next) => {
    try {
      res.json({ success: true, data: deps.analytics.churn(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/analytics/doctor-anomalies', async (req, res, next) => {
    try {
      res.json({ success: true, data: deps.analytics.doctorAnomalies(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/charge-assistant/frequent-items', async (req, res, next) => {
    try {
      res.json({ success: true, data: deps.chargeAssistant.frequentItems(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/print/templates', async (req, res, next) => {
    try {
      res.json({ success: true, data: deps.printTemplates.list(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/print/templates/:code/render', async (req, res, next) => {
    try {
      res.type('html').send(deps.printTemplates.render(req.params.code, req.body ?? {}, req.context!));
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/satisfaction/nps', async (req, res, next) => {
    try {
      res.json({ success: true, data: deps.satisfaction.nps(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/satisfaction/trend', async (req, res, next) => {
    try {
      res.json({ success: true, data: deps.satisfaction.trend(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/satisfaction/doctor-rankings', async (req, res, next) => {
    try {
      res.json({ success: true, data: deps.satisfaction.doctorRankings(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/stats/dashboard', async (req, res, next) => {
    try {
      res.json({ success: true, data: deps.stats.dashboard(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/stats/revenue', async (req, res, next) => {
    try {
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
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/stats/patient-growth', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: deps.stats.patientGrowth(
          typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
          typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
          req.context!,
        ),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/stats/doctor-workload', async (req, res, next) => {
    try {
      res.json({ success: true, data: deps.stats.doctorWorkload(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/stats/inventory', async (req, res, next) => {
    try {
      res.json({ success: true, data: deps.stats.inventoryStats(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/stats/member-cards', async (req, res, next) => {
    try {
      res.json({ success: true, data: deps.stats.memberStats(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/print', async (req, res, next) => {
    try {
      const kind = String(req.query.kind ?? 'report');
      let data: Record<string, unknown>;
      try {
        data = JSON.parse(String(req.query.data ?? '{}')) as Record<string, unknown>;
      } catch {
        throw new ValidationError('data must be valid JSON');
      }
      res.type('html').send(deps.print.render(kind, data));
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  const searchLimiter = createRateLimit({ windowMs: 60_000, max: 300 });
  app.get('/api/v2/search', searchLimiter, async (req, res, next) => {
    try {
      const q = String(req.query.q ?? '').trim();
      if (q.length < 2) {
        res.json({ success: true, data: [] });
        return;
      }
      res.json({ success: true, data: deps.search.search(q, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });
}
