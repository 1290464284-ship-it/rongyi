import type {
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
import type {
  AnalyticsService,
  ChargeAssistantService,
  ClinicalWorkflowService,
  PrintTemplateService,
  ReplenishmentService,
  WechatService,
} from '../../application/workflow-services';
import type { Logger } from '../../infrastructure/logger';
import type Database from 'better-sqlite3';
import type { RateLimitStore } from '../rate-limit';

export interface RouteDependencies {
  db: Database.Database;
  dbPath: string;
  logger: Logger;
  logDir: string;
  rateLimitStore?: RateLimitStore;
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
