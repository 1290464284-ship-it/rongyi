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
  SearchService,
  SatisfactionService,
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
import { StocktakeService } from '../../application/service-modules/stocktake';
import type { Logger } from '../../infrastructure/logger';
import type Database from 'better-sqlite3';
import type { RateLimitStore } from '../rate-limit';

export interface RouteDependenciesInput {
  db: Database.Database;
  dbPath: string;
  backupDir: string;
  logger: Logger;
  logDir: string;
  rateLimitStore?: RateLimitStore;
}

export function createRouteDependencies(input: RouteDependenciesInput): RouteDependencies {
  const { db, dbPath, backupDir, logger, logDir, rateLimitStore } = input;
  const stocktakes = new StocktakeService(db);
  const stocktakeLockGuard = (itemId: string, clinicId?: string | null) => stocktakes.assertNotLocked(itemId, clinicId);
  return {
    db,
    dbPath,
    logger,
    logDir,
    rateLimitStore,
    stocktakeLockGuard,
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
}

export interface RouteDependencies {
  db: Database.Database;
  dbPath: string;
  logger: Logger;
  logDir: string;
  rateLimitStore?: RateLimitStore;
  stocktakeLockGuard: (itemId: string, clinicId?: string | null) => void;
  authService: AuthService;
  audit: AuditService;
  appointments: AppointmentService;
  charges: ChargeService;
  inventory: InventoryService;
  followUps: FollowUpService;
  backups: BackupService;
  stats: StatsService;
  sync: SyncService;
  hr: HrService;
  alerts: AlertService;
  memberCards: MemberCardService;
  purchaseOrders: PurchaseOrderService;
  processingOrders: ProcessingOrderService;
  patientRisk: PatientRiskService;
  prescriptionSafety: PrescriptionSafetyService;
  cephalometric: CephalometricService;
  treatmentProgress: TreatmentProgressService;
  bulkImport: BulkImportService;
  debts: DebtService;
  notifications: NotificationService;
  satisfaction: SatisfactionService;
  clinicalWorkflow: ClinicalWorkflowService;
  replenishment: ReplenishmentService;
  wechat: WechatService;
  analytics: AnalyticsService;
  chargeAssistant: ChargeAssistantService;
  printTemplates: PrintTemplateService;
  search: SearchService;
}
