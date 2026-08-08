import cors from 'cors';
import express, { type Express, type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import type Database from 'better-sqlite3';
import { PrintService } from '../application/services';
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
import { registerFileRoutes, registerPublicFileRoutes } from './routes/files';
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
import { createRouteDependencies, type RouteDependencies } from './routes/deps';
import { createAuditBuffer } from './audit-buffer';
import { SqliteRateLimitStore } from '../infrastructure/rate-limit-store';

export type { AuditInput } from './audit-buffer';

export interface AppDependencies {
  db: Database.Database;
  dbPath: string;
  backupDir: string;
  logger: Logger;
  logDir: string;
}

export function createApp({ db, dbPath, backupDir, logger, logDir }: AppDependencies): Express {
  const app = express();
  const audit = createAuditBuffer(db, logger);
  // Test suites share one database across many login cases; use the in-memory
  // limiter there so per-request windows reset with each app. Production uses
  // the DB-backed store so multiple processes share the same windows.
  const rateLimitStore = process.env.NODE_ENV === 'test'
    ? undefined
    : new SqliteRateLimitStore(db);
  app.locals.audit = audit.push;
  app.locals.flushAuditNow = audit.flushNow;
  app.set('flushAudit', audit.flushNow);
  const deps: RouteDependencies = createRouteDependencies({
    db,
    dbPath,
    backupDir,
    logger,
    logDir,
    rateLimitStore,
  });

  app.disable('x-powered-by');
  app.use(helmet());
  const configuredCorsOrigins = (process.env.V2_CORS_ORIGIN ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  // P0-CORS: 打包版 Electron 渲染器以 file:// 加载，跨源请求的 Origin 可能为
  // file:// 或 opaque null。仅当 API 由 Electron 主进程拉起（V2_ELECTRON_RENDERER=1）
  // 时放行，避免打包版 UI 的所有 API 调用被浏览器 CORS 拦截。
  const isElectronRenderer = process.env.V2_ELECTRON_RENDERER === '1';
  app.use(cors({
    origin(origin, callback) {
      if (!origin || configuredCorsOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      // P2-4：'null' origin（沙盒/iframe/数据页）一律不放行；file:// 仅开发环境允许
      if (origin.startsWith('file://')) {
        if (process.env.NODE_ENV !== 'production' || isElectronRenderer) {
          callback(null, true);
          return;
        }
        callback(new Error('Not allowed by CORS'));
        return;
      }
      if (origin === 'null') {
        if (isElectronRenderer) {
          callback(null, true);
          return;
        }
        callback(new Error('Not allowed by CORS'));
        return;
      }
      try {
        const url = new URL(origin);
        const isLoopback = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
        // B-L5：显式端口缺失时按协议默认端口计算（http→80/https→443），否则
        // Number('') = NaN 会让 http://localhost 这类来源被误拒；开发模式额外
        // 放行 Vite 常用端口（5173/5180），方便本地前端直连 API。
        const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);
        const apiPort = Number(process.env.V2_PORT ?? 3180);
        const isAllowedPort = port === apiPort || (process.env.NODE_ENV !== 'production' && (port === 5173 || port === 5180));
        if (isLoopback && url.protocol === 'http:' && isAllowedPort) {
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

  app.get('/api/v2/health/deep', authMiddleware(deps.authService), roleMiddleware('BOSS'), wrapAsync(async (req, res) => {
      res.json({ success: true, data: deepHealth(db, backupDir) });
  }));

  app.get('/api/v2/metrics', authMiddleware(deps.authService), roleMiddleware('BOSS'), wrapAsync(async (req, res) => {
      const snapshot = metricsSnapshot();
      persistMetrics(logDir, snapshot);
      res.json({ success: true, data: snapshot });
  }));

  registerPublicAuthRoutes(app, deps);

  // S-L8：文件签名 GET 必须在 authMiddleware 之前注册——<img> 请求无法携带
  // Authorization 头，只能凭短期签名（exp+sig）访问；无效签名 next() 落回
  // 受保护路由（JWT 认证的常规 GET）。
  registerPublicFileRoutes(app, deps);

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
      audit.push({
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
  registerWorkbenchRoutes(app, deps);
  registerMedicalRecordEditRoutes(app, deps);
  registerFirstExamTrackingRoutes(app, deps);
  registerTreatmentPlanRoutes(app, deps);
  registerFollowUpExecutionRoutes(app, deps);
  registerMemberDiscountRoutes(app, deps);
  registerChargeComboRoutes(app, deps);
  registerRefundFlowRoutes(app, deps);
  registerCostShareRoutes(app, deps);
  registerProcessingSettleRoutes(app, deps);
  registerInventoryBatchRoutes(app, deps, { lockGuard: deps.stocktakeLockGuard });
  registerStocktakeRoutes(app, deps);
  registerDispenseRoutes(app, deps, { lockGuard: deps.stocktakeLockGuard });
  registerPurchaseReviewRoutes(app, deps);
  registerShiftTemplateRoutes(app, deps);
  registerUserRoleRoutes(app, deps);
  registerWechatReminderRoutes(app, deps);
  registerInventoryReportRoutes(app, deps);
  registerInventoryDocRoutes(app, deps);
  registerTreatmentPlanBillingRoutes(app, deps);
  registerPrescriptionProcessRoutes(app, deps);
  registerFirstExamRestartRoutes(app, deps);
  registerCephalometricReportRoutes(app, deps);
  registerProcessingFlowRoutes(app, deps);
  registerTriageRoutes(app, deps);
  registerPayMethodRoutes(app, deps);
  registerChargeTreeRoutes(app, deps);
  registerHighValueRoutes(app, deps);
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
