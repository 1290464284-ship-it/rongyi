import { randomUUID } from 'node:crypto';
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
import { StocktakeService } from '../application/service-modules/stocktake';
import { authMiddleware, errorMiddleware, roleMiddleware, traceMiddleware, wrapAsync } from './middleware';
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
import { registerFileRoutes } from './routes/files';
import { registerWorkbenchRoutes } from './routes/workbench-routes';
import { registerMedicalRecordEditRoutes } from './routes/medical-record-edit-routes';
import { registerFirstExamTrackingRoutes } from './routes/first-exam-tracking-routes';
import { registerTreatmentPlanRoutes } from './routes/treatment-plan-routes';
import { registerFollowUpExecutionRoutes } from './routes/follow-up-execution-routes';
import { registerMemberDiscountRoutes } from './routes/member-discount-routes';
import { registerChargeComboRoutes } from './routes/charge-combo-routes';
import { registerRefundFlowRoutes } from './routes/refund-flow-routes';
import { registerCostShareRoutes } from './routes/cost-share-routes';
import { registerProcessingSettleRoutes } from './routes/processing-settle-routes';
import { registerInventoryBatchRoutes } from './routes/inventory-batch-routes';
import { registerStocktakeRoutes } from './routes/stocktake-routes';
import { registerDispenseRoutes } from './routes/dispense-routes';
import { registerPurchaseReviewRoutes } from './routes/purchase-review-routes';
import { registerShiftTemplateRoutes } from './routes/shift-template-routes';
import { registerUserRoleRoutes } from './routes/user-role-routes';
import { registerWechatReminderRoutes } from './routes/wechat-reminder-routes';
import { registerInventoryReportRoutes } from './routes/inventory-report-routes';
import { registerInventoryDocRoutes } from './routes/inventory-doc-routes';
import { registerTreatmentPlanBillingRoutes } from './routes/treatment-plan-billing-routes';
import { registerPrescriptionProcessRoutes } from './routes/prescription-process-routes';
import { registerFirstExamRestartRoutes } from './routes/first-exam-restart-routes';
import { registerCephalometricReportRoutes } from './routes/cephalometric-report-routes';
import { registerProcessingFlowRoutes } from './routes/processing-flow-routes';
import { registerTriageRoutes } from './routes/triage-routes';
import { registerPayMethodRoutes } from './routes/pay-method-routes';
import { registerChargeTreeRoutes } from './routes/charge-tree-routes';
import { registerHighValueRoutes } from './routes/high-value-routes';
import type { RouteDependencies } from './routes/deps';

export interface AppDependencies {
  db: Database.Database;
  dbPath: string;
  backupDir: string;
  logger: Logger;
  logDir: string;
}

export interface AuditInput {
  userId?: string | null;
  userName?: string | null;
  action: string;
  target?: string | null;
  detail?: string | null;
  ip?: string | null;
  traceId?: string | null;
  clinicId?: string | null;
  statusCode?: number | null;
}

export function createApp({ db, dbPath, backupDir, logger, logDir }: AppDependencies): Express {
  const app = express();
  const auditBuffer: AuditInput[] = [];
  const AUDIT_FLUSH_INTERVAL = 1000;
  const AUDIT_BUFFER_MAX = 50;
  const insertAuditStmt = db.prepare(
    `INSERT INTO OperationLog (
       id, userId, userName, action, target, detail, ip, traceId,
       clinicId, statusCode, createdAt, updatedAt, deletedAt
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  );
  const flushAudit = db.transaction((rows: typeof auditBuffer) => {
    for (const input of rows) {
      const now = new Date().toISOString();
      insertAuditStmt.run(
        randomUUID(),
        input.userId ?? null,
        input.userName ?? null,
        input.action,
        input.target ?? null,
        input.detail ?? null,
        input.ip ?? null,
        input.traceId ?? null,
        input.clinicId ?? null,
        input.statusCode == null ? null : String(input.statusCode),
        now,
        now,
      );
    }
  });
  let _auditFlushScheduled = false;
  let _auditRetryScheduled = false;
  function scheduleAuditFlush(): void {
    if (_auditFlushScheduled) return;
    _auditFlushScheduled = true;
    setTimeout(() => {
      _auditFlushScheduled = false;
      if (auditBuffer.length === 0) return;
      const rows = auditBuffer.splice(0, auditBuffer.length);
      try {
        flushAudit(rows);
      } catch (error) {
        if (logger) logger.error('audit batch flush failed', { error });
        else console.error('audit batch flush failed', error);
        scheduleAuditRetry(rows);
      }
    }, AUDIT_FLUSH_INTERVAL).unref();
  }
  // M6-edge: flush 失败后恰好重试一次。_auditRetryScheduled 保证同一时间最多
  // 一轮重试在途（已有重试则放弃，仅记日志）；重试定时器到点时把失败行（已
  // 放回队首）与期间新入缓冲的行一起刷出；重试再失败只记日志，不再入队，
  // 避免无限重试。
  function scheduleAuditRetry(rows: typeof auditBuffer): void {
    if (_auditRetryScheduled) return;
    if (auditBuffer.length + rows.length > AUDIT_BUFFER_MAX * 2) return;
    auditBuffer.unshift(...rows);
    _auditRetryScheduled = true;
    setTimeout(() => {
      _auditRetryScheduled = false;
      if (auditBuffer.length === 0) return;
      const pending = auditBuffer.splice(0, auditBuffer.length);
      try {
        flushAudit(pending);
      } catch (error) {
        if (logger) logger.error('audit batch retry flush failed', { error });
        else console.error('audit batch retry flush failed', error);
      }
    }, AUDIT_FLUSH_INTERVAL).unref();
  }
  function pushAudit(input: typeof auditBuffer[number]): void {
    if (process.env.NODE_ENV === 'test') {
      const now = new Date().toISOString();
      insertAuditStmt.run(
        randomUUID(),
        input.userId ?? null,
        input.userName ?? null,
        input.action,
        input.target ?? null,
        input.detail ?? null,
        input.ip ?? null,
        input.traceId ?? null,
        input.clinicId ?? null,
        input.statusCode == null ? null : String(input.statusCode),
        now,
        now,
      );
      return;
    }
    auditBuffer.push(input);
    if (auditBuffer.length >= AUDIT_BUFFER_MAX) {
      const rows = auditBuffer.splice(0, AUDIT_BUFFER_MAX);
      try {
        flushAudit(rows);
      } catch (error) {
        if (logger) logger.error('audit batch flush failed', { error });
        else console.error('audit batch flush failed', error);
        scheduleAuditRetry(rows);
      }
    } else {
      scheduleAuditFlush();
    }
  }
  app.locals.audit = pushAudit;
  app.locals.flushAuditNow = shutdownFlushAudit;
  function shutdownFlushAudit(): void {
    if (auditBuffer.length === 0) return;
    const rows = auditBuffer.splice(0, auditBuffer.length);
    try {
      flushAudit(rows);
    } catch (error) {
      if (logger) logger.error('audit shutdown flush failed', { error });
      else console.error('audit shutdown flush failed', error);
    }
  }
  process.once('SIGINT', shutdownFlushAudit);
  process.once('SIGTERM', shutdownFlushAudit);
  app.set('flushAudit', shutdownFlushAudit);

  // 盘点锁定守卫：LOCKED 盘点单覆盖的物品在盘点期间禁止出入库。
  const stocktakes = new StocktakeService(db);
  const stocktakeLockGuard = (itemId: string, clinicId?: string | null) => stocktakes.assertNotLocked(itemId, clinicId);

  const deps: RouteDependencies = {
    db,
    dbPath,
    logger,
    logDir,
    authService: new AuthService(db),
    audit: new AuditService(db),
    appointments: new AppointmentService(db),
    charges: new ChargeService(db),
    inventory: new InventoryService(db, undefined, undefined, stocktakeLockGuard),
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
    wechat: new WechatService(db, undefined, undefined, logger),
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
      if (origin === 'null' || origin.startsWith('file://')) {
        callback(null, true);
        return;
      }
      try {
        const url = new URL(origin);
        const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
        if (
          isLoopback &&
          url.protocol === 'http:' &&
          (Number(url.port) === Number(process.env.V2_PORT ?? 3180) || Number(url.port) === 5180)
        ) {
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
        userId: req.context?.userId,
        clinicId: req.context?.clinicId ?? null,
      });
    });
    res.locals.startedAt = Date.now();
    next();
  });

  app.get('/api/v2/health', (_req, res) => {
    res.json({ success: true, data: { status: 'ok', time: new Date().toISOString() } });
  });

  app.get('/api/v2/health/deep', authMiddleware(deps.authService), roleMiddleware('BOSS', 'ADMIN'), wrapAsync(async (req, res) => {
      res.json({ success: true, data: deepHealth(db, backupDir) });
  }));

  app.get('/api/v2/metrics', authMiddleware(deps.authService), roleMiddleware('BOSS', 'ADMIN'), wrapAsync(async (req, res) => {
      const snapshot = metricsSnapshot();
      persistMetrics(logDir, snapshot);
      res.json({ success: true, data: snapshot });
  }));

  registerPublicAuthRoutes(app, deps);

  app.use('/api/v2', authMiddleware(deps.authService));
  // 审计中间件必须位于角色规则中间件之前：角色规则短路 403（next(error) 跳过
  // 后继中间件）时，只有已注册的 res.on('finish') 监听才能捕获越权尝试。
  app.use('/api/v2', (req, res, next) => {
    res.on('finish', () => {
      if (req.method === 'GET') return;
      const params = req.params as Record<string, string | undefined>;
      const auditOverride = res.locals.audit as
        | { action?: string; target?: string | null; detail?: string | null; clinicId?: string | null }
        | undefined;
      pushAudit({
        userId: req.context!.userId,
        action: auditOverride?.action ?? `${req.method} ${req.path}`,
        target: auditOverride?.target ?? params.id ?? params.resource ?? null,
        detail: auditOverride?.detail ?? (params.resource
          ? JSON.stringify({ resource: params.resource, body: maskSensitiveFields(req.body ?? {}) })
          : null),
        ip: req.ip,
        traceId: req.traceId,
        clinicId: auditOverride?.clinicId ?? req.context!.clinicId,
        statusCode: res.statusCode,
      });
    });
    next();
  });
  app.use('/api/v2', (req, res, next) => {
    const rule = routeRoleRules.find((candidate) => candidate.pattern.test(req.originalUrl));
    if (rule) {
      roleMiddleware(...rule.roles)(req, res, next);
      return;
    }
    next(new AppError('FORBIDDEN', 'Insufficient permissions', 403));
  });

  registerReadRoutes(app, {
    db,
    analytics: deps.analytics,
    chargeAssistant: deps.chargeAssistant,
    printTemplates: deps.printTemplates,
    satisfaction: deps.satisfaction,
    stats: deps.stats,
    print: new PrintService(),
    search: deps.search,
  });

  app.get('/api/v2/resource-meta', wrapAsync(async (req, res) => {
    res.json({ success: true, data: listAllResources(db) });
  }));

  registerAdminRoutes(app, deps);
  registerWorkflowRoutes(app, deps);
  registerSystemRoutes(app, deps);
  registerWorkbenchRoutes(app, db);
  registerMedicalRecordEditRoutes(app, db);
  registerFirstExamTrackingRoutes(app, db);
  registerTreatmentPlanRoutes(app, db);
  registerFollowUpExecutionRoutes(app, db);
  registerMemberDiscountRoutes(app, db);
  registerChargeComboRoutes(app, db);
  registerRefundFlowRoutes(app, db);
  registerCostShareRoutes(app, db);
  registerProcessingSettleRoutes(app, db);
  registerInventoryBatchRoutes(app, db, { lockGuard: stocktakeLockGuard });
  registerStocktakeRoutes(app, db);
  registerDispenseRoutes(app, db, { lockGuard: stocktakeLockGuard });
  registerPurchaseReviewRoutes(app, db);
  registerShiftTemplateRoutes(app, db);
  registerUserRoleRoutes(app, db);
  registerWechatReminderRoutes(app, db);
  registerInventoryReportRoutes(app, db);
  registerInventoryDocRoutes(app, db);
  registerTreatmentPlanBillingRoutes(app, db);
  registerPrescriptionProcessRoutes(app, db);
  registerFirstExamRestartRoutes(app, db);
  registerCephalometricReportRoutes(app, db);
  registerProcessingFlowRoutes(app, db);
  registerTriageRoutes(app, db);
  registerPayMethodRoutes(app, db);
  registerChargeTreeRoutes(app, db);
  registerHighValueRoutes(app, db);
  // file:// (打包版 Electron 渲染器) 以 <img> 加载 API 图片时,
  // 不受同源策略约束, 但 helmet 默认 Cross-Origin-Resource-Policy: same-origin
  // 会阻断响应; 仅对 files 路由放开 CORP。
  app.use('/api/v2/files', (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  });
  registerFileRoutes(app, deps);

  app.use((req, res) => {
    res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'Route not found' });
  });
  app.use((error: unknown, req: Request, res: Response, next: NextFunction) => {
    errorMiddleware(error, req, res, next, logger);
  });

  return app;
}
