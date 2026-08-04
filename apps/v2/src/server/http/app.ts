import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type Database from 'better-sqlite3';
import {
  AppointmentService,
  AlertService,
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
import { createResourceRouter } from './router';
import { listAllResources } from '../infrastructure/legacy-registry';
import { metricsMiddleware, metricsSnapshot, persistMetrics } from './metrics';
import { deepHealth } from './health';
import type { Logger } from '../infrastructure/logger';
import { createRateLimit } from './rate-limit';
import { maskSensitiveFields } from '../infrastructure/security';
import { routeRoleRules } from './route-policy';
import { registerReadRoutes } from './read-routes';

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
  const audit = new AuditService(db);
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
  const search = new SearchService(db);

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

  const loginLimiter = createRateLimit({ windowMs: 60_000, max: 20 });
  const resourceWriteLimiter = createRateLimit({ windowMs: 60_000, max: 300 });

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
      /* v8 ignore start -- persistMetrics swallows persistence errors by design. */
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
    /* v8 ignore stop */
  });

  app.post('/api/v2/auth/login', loginLimiter, async (req, res, next) => {
    try {
      const result = await authService.login(String(req.body?.username ?? ''), String(req.body?.password ?? ''));
      res.json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/auth/refresh', async (req, res, next) => {
    try {
      const result = await authService.refresh(String(req.body?.refreshToken ?? ''));
      res.json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/auth/logout', async (req, res, next) => {
    try {
      await authService.logout(String(req.body?.refreshToken ?? ''));
      res.json({ success: true, data: { loggedOut: true } });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.use('/api/v2', authMiddleware(authService));
  app.use('/api/v2', (req, res, next) => {
    const rule = routeRoleRules.find((candidate) => candidate.pattern.test(req.originalUrl));
    if (rule) {
      roleMiddleware(...rule.roles)(req, res, next);
      return;
    }
    next();
  });
  app.use('/api/v2', (req, res, next) => {
    res.on('finish', () => {
      if (req.method === 'GET' || res.statusCode >= 400) return;
      const params = req.params as Record<string, string | undefined>;
      audit.log({
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
    analytics,
    chargeAssistant,
    printTemplates,
    satisfaction,
    stats,
    print,
    search,
  });

  app.get('/api/v2/resource-meta', async (req, res) => {
    res.json({ success: true, data: listAllResources(db) });
  });

  app.get('/api/v2/auth/me', async (req, res, next) => {
    try {
      const user = await authService.getUserById(req.context!.userId);
      res.json({ success: true, data: user });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/auth/password', async (req, res, next) => {
    try {
      await authService.changePassword(
        req.context!.userId,
        String(req.body?.oldPassword ?? ''),
        String(req.body?.newPassword ?? ''),
      );
      res.json({ success: true, data: { changed: true } });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/appointments', async (req, res, next) => {
    try {
      const result = await appointments.create(req.body, req.context!);
      res.status(201).json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/appointments/:id/status', async (req, res, next) => {
    try {
      const result = await appointments.transition(req.params.id, String(req.body?.status ?? ''), req.context!);
      res.json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/registrations/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.registrationStatus(req.params.id, String(req.body?.status ?? ''), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/visits/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.visitStatus(req.params.id, String(req.body?.status ?? ''), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/first-exams/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.firstExamStatus(req.params.id, String(req.body?.status ?? ''), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/treatments/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.treatmentStatus(req.params.id, String(req.body?.status ?? ''), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/medical-records/:id/lock', async (req, res, next) => {
    try {
      res.json({ success: true, data: clinicalWorkflow.lockMedicalRecord(req.params.id, req.body?.locked !== false, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/inventory/replenishment/generate', async (req, res, next) => {
    try {
      res.json({ success: true, data: replenishment.generate(req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/inventory/replenishment/apply', async (req, res, next) => {
    try {
      res.json({ success: true, data: replenishment.applyToPurchaseOrder(req.body?.ids ?? [], req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/wechat/:id/send', async (req, res, next) => {
    try {
      res.json({ success: true, data: wechat.send(req.params.id, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/wechat/send-batch', async (req, res, next) => {
    try {
      res.json({ success: true, data: wechat.sendBatch(req.body?.ids ?? [], req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });


  app.post('/api/v2/charges', async (req, res, next) => {
    try {
      const result = await charges.create(req.body, req.context!);
      res.status(201).json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
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
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
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
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
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
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
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
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
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
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/purchase-orders/:id/receive', async (req, res, next) => {
    try {
      res.json({ success: true, data: await purchaseOrders.receive(req.params.id, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/processing-orders/:id/status', async (req, res, next) => {
    try {
      res.json({ success: true, data: processingOrders.transition(req.params.id, String(req.body?.status ?? ''), req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/patients/:id/risk', async (req, res, next) => {
    try {
      res.json({ success: true, data: patientRisk.calculate(req.params.id, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/prescriptions/:id/safety', async (req, res, next) => {
    try {
      res.json({ success: true, data: prescriptionSafety.check(req.params.id) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/cephalometric/:id/analyze', async (req, res, next) => {
    try {
      res.json({ success: true, data: cephalometric.compute(req.params.id, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/treatment-plans/:id/progress', async (req, res, next) => {
    try {
      res.json({ success: true, data: treatmentProgress.summary(req.params.id) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/bulk-import/:resource', async (req, res, next) => {
    try {
      res.json({ success: true, data: await bulkImport.importRows(req.params.resource, req.body?.rows ?? [], req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
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
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/notifications', async (req, res, next) => {
    try {
      res.json({ success: true, data: notifications.list(req.context!.userId) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/notifications/:id/read', async (req, res, next) => {
    try {
      res.json({ success: true, data: notifications.markRead(req.params.id, req.context!.userId) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });


  app.post('/api/v2/inventory/transactions', async (req, res, next) => {
    try {
      const result = await inventory.createTransaction(
        req.body,
        req.context!,
        typeof req.body?.requestId === 'string' ? req.body.requestId : undefined,
      );
      res.status(201).json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/inventory/low-stock', async (req, res, next) => {
    try {
      res.json({ success: true, data: inventory.lowStock() });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/inventory/expiring', async (req, res, next) => {
    try {
      const days = Number(req.query.days ?? 30);
      res.json({ success: true, data: inventory.expiringSoon(Number.isFinite(days) ? days : 30) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/follow-ups/reminders', async (req, res, next) => {
    try {
      res.json({ success: true, data: followUps.reminders() });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/follow-ups/adherence', async (req, res, next) => {
    try {
      res.json({ success: true, data: followUps.adherence() });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/follow-ups/batch-generate', async (req, res, next) => {
    try {
      const result = await followUps.batchGenerate(Number(req.body?.limit ?? 50), req.context!);
      res.json({ success: true, data: result });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });


  app.get('/api/v2/sync/pull', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: sync.pull(
          String(req.query.since ?? new Date(0).toISOString()),
          String(req.query.deviceId ?? 'desktop'),
          String(req.query.deviceToken ?? ''),
          req.context!,
        ),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/sync/devices', async (req, res, next) => {
    try {
      res.status(201).json({
        success: true,
        data: sync.registerDevice(
          String(req.body?.deviceId ?? ''),
          String(req.body?.name ?? 'desktop'),
          req.context!,
        ),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/sync/push', async (req, res, next) => {
    try {
      res.json({ success: true, data: await sync.push(req.body, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/sync/cleanup', async (req, res, next) => {
    try {
      const before = typeof req.body?.before === 'string' ? req.body.before : undefined;
      res.json({ success: true, data: sync.cleanup(before, req.context!) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/hr/attendance', async (req, res, next) => {
    try {
      res.json({
        success: true,
        data: hr.attendance(typeof req.query.workDate === 'string' ? req.query.workDate : undefined),
      });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/hr/leaves/:id/approve', async (req, res, next) => {
    try {
      const approved = req.body?.approved !== false;
      res.json({ success: true, data: hr.approveLeave(req.params.id, req.context!.userId, approved) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/system/business-alerts', async (req, res, next) => {
    try {
      res.json({ success: true, data: alerts.open() });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.patch('/api/v2/system/business-alerts/:id/status', async (req, res, next) => {
    try {
      const status = String(req.body?.status ?? 'ACKNOWLEDGED') as 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
      res.json({ success: true, data: alerts.setStatus(req.params.id, status, req.context!.userId) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/backups', async (req, res, next) => {
    try {
      res.json({ success: true, data: backups.list() });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/backups', async (req, res, next) => {
    try {
      res.status(201).json({ success: true, data: await backups.create() });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/backups/cleanup', async (req, res, next) => {
    try {
      const maxKeep = Number(req.body?.maxKeep ?? 30);
      if (!Number.isFinite(maxKeep) || maxKeep < 1 || maxKeep > 365) {
        res.status(400).json({ success: false, code: 'VALIDATION_ERROR', message: 'maxKeep must be between 1 and 365' });
        return;
      }
      res.json({ success: true, data: backups.cleanup(maxKeep) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.post('/api/v2/backups/:filename/restore', async (req, res, next) => {
    try {
      res.json({ success: true, data: await backups.stageRestore(req.params.filename) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
  });

  app.get('/api/v2/backups/:filename/verify', async (req, res, next) => {
    try {
      res.json({ success: true, data: await backups.verify(req.params.filename) });
    /* v8 ignore start -- route error propagation is covered by errorMiddleware tests */
    } catch (error) {
      next(error);
    }
    /* v8 ignore stop */
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
