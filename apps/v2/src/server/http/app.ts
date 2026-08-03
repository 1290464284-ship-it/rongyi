import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type Database from 'better-sqlite3';
import {
  AppointmentService,
  AlertService,
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
import { authMiddleware, errorMiddleware, traceMiddleware } from './middleware';
import { createResourceRouter } from './router';
import { listAllResources } from '../infrastructure/legacy-registry';
import { metricsMiddleware, metricsSnapshot, persistMetrics } from './metrics';
import { deepHealth } from './health';
import type { Logger } from '../infrastructure/logger';
import { createRateLimit } from './rate-limit';

export interface AppDependencies {
  db: Database.Database;
  dbPath: string;
  backupDir: string;
  logger: Logger;
  logDir: string;
}

export function createApp({ db, dbPath, backupDir, logger, logDir }: AppDependencies): Express {
  const app = express();
  const authService = new AuthService(db);
  const appointments = new AppointmentService(db);
  const charges = new ChargeService(db);
  const inventory = new InventoryService(db);
  const followUps = new FollowUpService(db);
  const backups = new BackupService(db, dbPath, backupDir);
  const stats = new StatsService(db);
  const print = new PrintService();
  const sync = new SyncService(db);
  const hr = new HrService(db);
  const alerts = new AlertService(db);
  const memberCards = new MemberCardService(db);
  const purchaseOrders = new PurchaseOrderService(db);
  const processingOrders = new ProcessingOrderService(db);
  const patientRisk = new PatientRiskService(db);
  const prescriptionSafety = new PrescriptionSafetyService(db);
  const cephalometric = new CephalometricService(db);
  const treatmentProgress = new TreatmentProgressService(db);
  const bulkImport = new BulkImportService(db);
  const debts = new DebtService(db);
  const notifications = new NotificationService(db);
  const satisfaction = new SatisfactionService(db);
  const clinicalWorkflow = new ClinicalWorkflowService(db);
  const replenishment = new ReplenishmentService(db);
  const wechat = new WechatService(db);
  const analytics = new AnalyticsService(db);
  const chargeAssistant = new ChargeAssistantService(db);
  const printTemplates = new PrintTemplateService(db);

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
        durationMs: Date.now() - (res.locals.startedAt ?? Date.now()),
      });
    });
    res.locals.startedAt = Date.now();
    next();
  });

  app.get('/api/v2/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } });
  });

  const loginLimiter = createRateLimit({ windowMs: 60_000, max: 20 });
  const resourceWriteLimiter = createRateLimit({ windowMs: 60_000, max: 300 });

  app.get('/api/v2/health/deep', async (req, res, next) => {
    try {
      res.json({ success: true, data: deepHealth(db, backupDir) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/metrics', async (req, res, next) => {
    try {
      const snapshot = metricsSnapshot();
      persistMetrics(logDir, snapshot);
      res.json({ success: true, data: snapshot });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/auth/login', loginLimiter, async (req, res, next) => {
    try {
      const result = await authService.login(String(req.body?.username ?? ''), String(req.body?.password ?? ''));
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/v2', authMiddleware(authService));

  app.get('/api/v2/resource-meta', async (req, res) => {
    res.json({ success: true, data: listAllResources(db) });
  });

  app.get('/api/v2/auth/me', async (req, res, next) => {
    try {
      const user = await authService.getUserById(req.context!.userId);
      res.json({ success: true, data: user });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v2/auth/password', async (req, res, next) => {
    try {
      await authService.changePassword(
        req.context!.userId,
        String(req.body?.oldPassword ?? ''),
        String(req.body?.newPassword ?? ''),
      );
      res.json({ success: true, data: { changed: true } });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/appointments', async (req, res, next) => {
    try {
      const result = await appointments.create(req.body, req.context!);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v2/appointments/:id/status', async (req, res, next) => {
    try {
      const result = await appointments.transition(req.params.id, String(req.body?.status ?? ''), req.context!);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v2/registrations/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.registrationStatus(req.params.id, String(req.body?.status ?? ''), req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v2/visits/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.visitStatus(req.params.id, String(req.body?.status ?? ''), req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v2/first-exams/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.firstExamStatus(req.params.id, String(req.body?.status ?? ''), req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v2/treatments/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.treatmentStatus(req.params.id, String(req.body?.status ?? ''), req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v2/medical-records/:id/lock', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.lockMedicalRecord(req.params.id, req.body?.locked !== false, req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/inventory/replenishment/generate', async (req, res, next) => {
    try {
      res.json({ success: true, data: replenishment.generate(req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/inventory/replenishment/apply', async (req, res, next) => {
    try {
      res.json({ success: true, data: replenishment.applyToPurchaseOrder(req.body?.ids ?? [], req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/wechat/:id/send', async (req, res, next) => {
    try {
      res.json({ success: true, data: wechat.send(req.params.id, req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/wechat/send-batch', async (req, res, next) => {
    try {
      res.json({ success: true, data: wechat.sendBatch(req.body?.ids ?? [], req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/analytics/rfm', async (req, res, next) => {
    try {
      res.json({ success: true, data: analytics.rfm(req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/analytics/churn', async (req, res, next) => {
    try {
      res.json({ success: true, data: analytics.churn(req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/analytics/doctor-anomalies', async (req, res, next) => {
    try {
      res.json({ success: true, data: analytics.doctorAnomalies(req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/charge-assistant/frequent-items', async (req, res, next) => {
    try {
      res.json({ success: true, data: chargeAssistant.frequentItems() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/print/templates', async (req, res, next) => {
    try {
      res.json({ success: true, data: printTemplates.list() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/print/templates/:code/render', async (req, res, next) => {
    try {
      res.type('html').send(printTemplates.render(req.params.code, req.body ?? {}));
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/charges', async (req, res, next) => {
    try {
      const result = await charges.create(req.body, req.context!);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v2/charges/:id/pay', async (req, res, next) => {
    try {
      const result = await charges.pay(
        req.params.id,
        Number(req.body?.amount ?? 0),
        String(req.body?.method ?? 'CASH'),
        typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        req.context!,
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/charges/:id/refund', async (req, res, next) => {
    try {
      const result = await charges.refund(
        req.params.id,
        Number(req.body?.amount ?? 0),
        String(req.body?.reason ?? ''),
        req.context!,
        typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/member-cards/:id/recharge', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await memberCards.recharge(
          req.params.id,
          Number(req.body?.amount ?? 0),
          req.context!,
          typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/member-cards/:id/consume', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await memberCards.consume(
          req.params.id,
          Number(req.body?.amount ?? 0),
          req.context!,
          typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/member-cards/:id/points', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: await memberCards.addPoints(
          req.params.id,
          Number(req.body?.points ?? 0),
          req.context!,
          typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v2/purchase-orders/:id/receive', async (req, res, next) => {
    try {
      res.json({ success: true, data: await purchaseOrders.receive(req.params.id, req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v2/processing-orders/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: processingOrders.transition(req.params.id, String(req.body?.status ?? ''), req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/patients/:id/risk', async (req, res, next) => {
    try {
      res.json({ success: true, data: patientRisk.calculate(req.params.id, req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/prescriptions/:id/safety', async (req, res, next) => {
    try {
      res.json({ success: true, data: prescriptionSafety.check(req.params.id) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/cephalometric/:id/analyze', async (req, res, next) => {
    try {
      res.json({ success: true, data: cephalometric.compute(req.params.id, req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/treatment-plans/:id/progress', async (req, res, next) => {
    try {
      res.json({ success: true, data: treatmentProgress.summary(req.params.id) });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/bulk-import/:resource', async (req, res, next) => {
    try {
      res.json({ success: true, data: await bulkImport.importRows(req.params.resource, req.body?.rows ?? [], req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v2/debts/:id/pay', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: debts.pay(
          req.params.id,
          Number(req.body?.amount ?? 0),
          req.context!,
          typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/notifications', async (req, res, next) => {
    try {
      res.json({ success: true, data: notifications.list(req.context!.userId) });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v2/notifications/:id/read', async (req, res, next) => {
    try {
      res.json({ success: true, data: notifications.markRead(req.params.id) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/satisfaction/nps', async (req, res, next) => {
    try {
      res.json({ success: true, data: satisfaction.nps() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/satisfaction/trend', async (req, res, next) => {
    try {
      res.json({ success: true, data: satisfaction.trend() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/inventory/transactions', async (req, res, next) => {
    try {
      const result = await inventory.createTransaction(
        req.body,
        req.context!,
        typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
      );
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/inventory/low-stock', async (req, res, next) => {
    try {
      res.json({ success: true, data: inventory.lowStock() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/follow-ups/reminders', async (req, res, next) => {
    try {
      res.json({ success: true, data: followUps.reminders() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/follow-ups/batch-generate', async (req, res, next) => {
    try {
      const result = await followUps.batchGenerate(Number(req.body?.limit ?? 50), req.context!);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/stats/dashboard', async (req, res, next) => {
    try {
      res.json({ success: true, data: stats.dashboard(req.context!) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/stats/revenue', async (req, res, next) => {
    try {
      const groupBy = req.query.groupBy === 'month' ? 'month' : 'day';
      res.json({
        success: true,
        data: stats.revenue(
          typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
          typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
          groupBy,
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/stats/patient-growth', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: stats.patientGrowth(
          typeof req.query.startDate === 'string' ? req.query.startDate : undefined,
          typeof req.query.endDate === 'string' ? req.query.endDate : undefined,
        ),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/stats/doctor-workload', async (req, res, next) => {
    try {
      res.json({ success: true, data: stats.doctorWorkload() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/stats/inventory', async (req, res, next) => {
    try {
      res.json({ success: true, data: stats.inventoryStats() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/stats/member-cards', async (req, res, next) => {
    try {
      res.json({ success: true, data: stats.memberStats() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/print', async (req, res, next) => {
    try {
      const kind = String(req.query.kind ?? 'report');
      const data = JSON.parse(String(req.query.data ?? '{}')) as Record<string, unknown>;
      res.type('html').send(print.render(kind, data));
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/sync/pull', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: sync.pull(String(req.query.since ?? new Date(0).toISOString()), String(req.query.deviceId ?? 'desktop')),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/sync/push', async (req, res, next) => {
    try {
      res.json({ success: true, data: sync.push(req.body) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/hr/attendance', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: hr.attendance(typeof req.query.workDate === 'string' ? req.query.workDate : undefined),
      });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v2/hr/leaves/:id/approve', async (req, res, next) => {
    try {
      const approved = req.body?.approved !== false;
      res.json({ success: true, data: hr.approveLeave(req.params.id, req.context!.userId, approved) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/system/business-alerts', async (req, res, next) => {
    try {
      res.json({ success: true, data: alerts.open() });
    } catch (error) {
      next(error);
    }
  });

  app.patch('/api/v2/system/business-alerts/:id/status', async (req, res, next) => {
    try {
      const status = String(req.body?.status ?? 'ACKNOWLEDGED') as 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
      res.json({ success: true, data: alerts.setStatus(req.params.id, status, req.context!.userId) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/backups', async (req, res, next) => {
    try {
      res.json({ success: true, data: backups.list() });
    } catch (error) {
      next(error);
    }
  });

  app.post('/api/v2/backups', async (req, res, next) => {
    try {
      res.status(201).json({ success: true, data: await backups.create() });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/backups/:filename/verify', async (req, res, next) => {
    try {
      res.json({ success: true, data: await backups.verify(req.params.filename) });
    } catch (error) {
      next(error);
    }
  });

  app.get('/api/v2/search', async (req, res, next) => {
    try {
      const q = String(req.query.q ?? '').trim();
      if (q.length < 2) {
        res.json({ success: true, data: [] });
        return;
      }
      const patients = db.prepare(
        `SELECT id, name, phone, code FROM Patient WHERE deletedAt IS NULL AND (name LIKE ? OR phone LIKE ? OR code LIKE ?) LIMIT 20`,
      ).all(`%${q}%`, `%${q}%`, `%${q}%`);
      res.json({ success: true, data: patients });
    } catch (error) {
      next(error);
    }
  });

  app.use('/api/v2/resources', resourceWriteLimiter, createResourceRouter(db));

  app.use((req, res) => {
    res.status(404).json({ success: false, code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` });
  });
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    errorMiddleware(error, req, res, next, logger);
  });

  return app;
}
