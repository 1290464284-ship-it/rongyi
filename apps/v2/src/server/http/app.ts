import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type Database from 'better-sqlite3';
import {
  AlertService,
  AppointmentService,
  AuditService,
  AuthService,
  BackupService,
  BulkImportService,
  CephalometricService,
  ChargeService,
  DebtService,
  FollowUpService,
  HrService,
  InventoryService,
  MemberCardService,
  NotificationService,
  PatientRiskService,
  PrescriptionSafetyService,
  PrintService,
  ProcessingOrderService,
  PurchaseOrderService,
  SearchService,
  SatisfactionService,
  StatsService,
  SyncService,
  TreatmentProgressService,
} from '../application/services';
import {
  AnalyticsService,
  ChargeAssistantService,
  ClinicalWorkflowService,
  PrintTemplateService,
  ReplenishmentService,
  WechatService,
} from '../application/workflow-services';
import { authMiddleware, errorMiddleware, roleMiddleware, traceMiddleware } from './middleware';
import { AppError } from '../infrastructure/errors';
import { listAllResources } from '../infrastructure/legacy-registry';
import { metricsMiddleware, metricsSnapshot, persistMetrics } from './metrics';
import { deepHealth } from './health';
import type { Logger } from '../infrastructure/logger';
import { maskSensitiveFields } from '../infrastructure/security';
import { routeRoleRules } from './route-policy';
import { registerReadRoutes } from './read-routes';
import { registerAdminRoutes, registerPublicAuthRoutes } from './routes/auth-admin';
import { registerWorkflowRoutes } from './routes/workflow';
import { registerSystemRoutes } from './routes/system';
import type { RouteDependencies } from './routes/deps';

export interface AppDependencies {
  db: Database.Database;
  dbPath: string;
  backupDir: string;
  logger: Logger;
  logDir: string;
}

export function createApp({ db, dbPath, backupDir, logger, logDir }: AppDependencies): Express {
  const app = express();
  const deps: RouteDependencies = {
    db,
    logger,
    logDir,
    authService: new AuthService(db),
    audit: new AuditService(db),
    appointments: new AppointmentService(db),
    charges: new ChargeService(db),
    inventory: new InventoryService(db),
    followUps: new FollowUpService(db),
    backups: new BackupService(db, dbPath, backupDir),
    stats: new StatsService(db),
    sync: new SyncService(db),
    hr: new HrService(db),
    alerts: new AlertService(db),
    memberCards: new MemberCardService(db),
    purchaseOrders: new PurchaseOrderService(db),
    processingOrders: new ProcessingOrderService(db),
    patientRisk: new PatientRiskService(db),
    prescriptionSafety: new PrescriptionSafetyService(db),
    cephalometric: new CephalometricService(db),
    treatmentProgress: new TreatmentProgressService(db),
    bulkImport: new BulkImportService(db),
    debts: new DebtService(db),
    notifications: new NotificationService(db),
    satisfaction: new SatisfactionService(db),
    clinicalWorkflow: new ClinicalWorkflowService(db),
    replenishment: new ReplenishmentService(db),
    wechat: new WechatService(db),
    analytics: new AnalyticsService(db),
    chargeAssistant: new ChargeAssistantService(db),
    printTemplates: new PrintTemplateService(db),
    search: new SearchService(db),
  };

  app.disable('x-powered-by');
  app.use(helmet());
  const configuredCorsOrigins = (process.env.V2_CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.use(cors({
    origin(origin, callback) {
      if (!origin || configuredCorsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      try {
        const url = new URL(origin);
        if (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')) {
          callback(null, true);
          return;
        }
      } catch {
        // fall through to rejection
      }
      callback(new Error('Not allowed by CORS'));
    },
  }));
  app.use(express.json({ limit: '2mb' }));
  app.use(traceMiddleware);
  app.use(metricsMiddleware);
  app.use((req, res, next) => {
    res.on('finish', () => {
      logger.info('request', {
        traceId: req.traceId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        durationMs: Date.now() - Number(res.locals.startedAt),
      });
    });
    res.locals.startedAt = Date.now();
    next();
  });

  app.get('/api/v2/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } });
  });

  app.get('/api/v2/health/deep', async (req, res, next) => {
    try {
      res.json({ success: true, data: deepHealth(db, backupDir) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/metrics', async (req, res, next) => {
    try {
      const snapshot = metricsSnapshot();
      persistMetrics(logDir, snapshot);
      res.json({ success: true, data: snapshot });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  registerPublicAuthRoutes(app, deps);

  app.use('/api/v2', authMiddleware(deps.authService));
  app.use('/api/v2', (req, res, next) => {
    const rule = routeRoleRules.find((candidate) => candidate.pattern.test(req.originalUrl));
    if (rule) {
      roleMiddleware(...rule.roles)(req, res, next);
      return;
    }
    next(new AppError('FORBIDDEN', 'Insufficient permissions', 403));
  });
  app.use('/api/v2', (req, res, next) => {
    res.on('finish', () => {
      if (req.method === 'GET' || res.statusCode >= 400) return;
      const params = req.params as Record<string, string | undefined>;
      deps.audit.log({
        userId: req.context!.userId,
        action: `${req.method} ${req.path}`,
        target: params.id ?? params.resource ?? null,
        detail: params.resource
          ? JSON.stringify({ resource: params.resource, body: maskSensitiveFields(req.body ?? {}) })
          : null,
        ip: req.ip,
        traceId: req.traceId,
        clinicId: req.context!.clinicId,
      });
    });
    next();
  });

  registerReadRoutes(app, {
    analytics: deps.analytics,
    chargeAssistant: deps.chargeAssistant,
    printTemplates: deps.printTemplates,
    satisfaction: deps.satisfaction,
    stats: deps.stats,
    print: new PrintService(),
    search: deps.search,
  });

  app.get('/api/v2/resource-meta', async (req, res) => {
    res.json({ success: true, data: listAllResources(db) });
  });

  registerAdminRoutes(app, deps);
  registerWorkflowRoutes(app, deps);
  registerSystemRoutes(app, deps);

  app.use((req, res) => {
    res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Route not found' });
  });
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    errorMiddleware(error, req, res, next, logger);
  });

  return app;
}
