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
  ProcessingOrderService,
  PurchaseOrderService,
  SatisfactionService,
  SearchService,
  StatsService,
  SyncService,
  TreatmentProgressService,
} from '../../application/services';
import {
  AnalyticsService,
  ChargeAssistantService,
  ClinicalWorkflowService,
  PrintTemplateService,
  ReplenishmentService,
  WechatService,
} from '../../application/workflow-services';
import { Logger } from '../../infrastructure/logger';
import type { RouteDependencies } from './deps';

export interface BuildRouteDepsOptions {
  dbPath?: string;
  backupDir?: string;
}

/**
 * 测试用 RouteDependencies 构造器（L-02：统一 registerXxxRoutes(app, deps)
 * 单签名）。镜像 app.ts 组合根的服务实例化，仅供路由 spec 使用；logger
 * 无 logDir，只打到控制台。需要替换个别服务时传覆盖对象。
 */
export function buildRouteDeps(
  db: Database.Database,
  options: BuildRouteDepsOptions = {},
  overrides: Partial<RouteDependencies> = {},
): RouteDependencies {
  const base: RouteDependencies = {
    db,
    dbPath: options.dbPath ?? 'v2.sqlite',
    logger: new Logger(),
    logDir: '',
    stocktakeLockGuard: () => undefined,
    authService: new AuthService(db),
    audit: new AuditService(db),
    appointments: new AppointmentService(db),
    charges: new ChargeService(db),
    inventory: new InventoryService(db),
    followUps: new FollowUpService(db),
    backups: new BackupService(db, options.dbPath ?? 'v2.sqlite', options.backupDir ?? 'backups'),
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
    wechat: new WechatService(db, undefined, undefined, new Logger()),
    analytics: new AnalyticsService(db),
    chargeAssistant: new ChargeAssistantService(db),
    printTemplates: new PrintTemplateService(db),
    search: new SearchService(db),
  };
  return { ...base, ...overrides };
}
