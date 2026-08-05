/**
 * Domain contracts for the refactored dental clinic system.
 *
 * This file is the single source of truth for domain types. Infrastructure,
 * use cases, HTTP adapters, and the web application must depend on these
 * contracts rather than on each other.
 *
 * TODO: 渐进拆分规划
 * - domain/enums.ts: 抽离 UserRole / Gender / AppointmentStatus 等所有枚举常量与联合类型
 * - domain/entities.ts: 抽离 Clinic / User / Patient / Appointment 等实体接口（继承 Entity/SoftDeletable）
 * - shared/contracts.ts: 抽离 Page<T> / Result<T> / AppErrorLike / IRepository 等跨层通用契约
 */

// ---------------------------------------------------------------------------
// Cross-cutting primitives
// ---------------------------------------------------------------------------

export type ID = string;
export type UTCDateTime = string;
export type ClinicDate = string;
export type Cents = number;
export const CLINIC_TZ_OFFSET_HOURS = 8;

export interface Entity {
  id: ID;
  clinicId?: ID | null;
  createdAt: UTCDateTime;
  updatedAt: UTCDateTime;
}

export interface SoftDeletable {
  deletedAt?: UTCDateTime | null;
}

export type StoredEntity<T extends Entity> = T & SoftDeletable;

export interface PageQuery {
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: AppErrorLike };

export interface AppErrorLike {
  code: string;
  message: string;
  status: number;
  details?: unknown;
  traceId?: string;
}

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const UserRole = {
  BOSS: 'BOSS',
  ADMIN: 'ADMIN',
  DOCTOR: 'DOCTOR',
  RECEPTIONIST: 'RECEPTIONIST',
  NURSE: 'NURSE',
  TECHNICIAN: 'TECHNICIAN',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];

export const Gender = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  UNKNOWN: 'UNKNOWN',
} as const;
export type Gender = (typeof Gender)[keyof typeof Gender];

export const PatientSource = {
  WALK_IN: 'WALK_IN',
  REFERRAL: 'REFERRAL',
  ONLINE: 'ONLINE',
  OTHER: 'OTHER',
} as const;
export type PatientSource = (typeof PatientSource)[keyof typeof PatientSource];

export const AppointmentStatus = {
  BOOKED: 'BOOKED',
  ARRIVED: 'ARRIVED',
  IN_CHAIR: 'IN_CHAIR',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
} as const;
export type AppointmentStatus = (typeof AppointmentStatus)[keyof typeof AppointmentStatus];

export const AppointmentType = {
  REGULAR: 'REGULAR',
  FOLLOW_UP: 'FOLLOW_UP',
  EMERGENCY: 'EMERGENCY',
  CONSULTATION: 'CONSULTATION',
} as const;
export type AppointmentType = (typeof AppointmentType)[keyof typeof AppointmentType];

export const VisitStatus = {
  REGISTERED: 'REGISTERED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type VisitStatus = (typeof VisitStatus)[keyof typeof VisitStatus];

export const TreatmentStatus = {
  PLANNED: 'PLANNED',
  APPROVED: 'APPROVED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type TreatmentStatus = (typeof TreatmentStatus)[keyof typeof TreatmentStatus];

export const ChargeStatus = {
  UNPAID: 'UNPAID',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
} as const;
export type ChargeStatus = (typeof ChargeStatus)[keyof typeof ChargeStatus];

export const PayMethod = {
  CASH: 'CASH',
  WECHAT: 'WECHAT',
  ALIPAY: 'ALIPAY',
  CARD: 'CARD',
  DEBT: 'DEBT',
  MEMBER_CARD: 'MEMBER_CARD',
  UNIONPAY: 'UNIONPAY',
  INSURANCE: 'INSURANCE',
  OTHER: 'OTHER',
} as const;
export type PayMethod = (typeof PayMethod)[keyof typeof PayMethod];

export const DebtStatus = {
  UNPAID: 'UNPAID',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;
export type DebtStatus = (typeof DebtStatus)[keyof typeof DebtStatus];

export const FollowUpStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type FollowUpStatus = (typeof FollowUpStatus)[keyof typeof FollowUpStatus];

export const RegistrationType = {
  REGULAR: 'REGULAR',
  EMERGENCY: 'EMERGENCY',
  FOLLOW_UP: 'FOLLOW_UP',
} as const;
export type RegistrationType = (typeof RegistrationType)[keyof typeof RegistrationType];

export const RegistrationStatus = {
  REGISTERED: 'REGISTERED',
  TRIAGED: 'TRIAGED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type RegistrationStatus = (typeof RegistrationStatus)[keyof typeof RegistrationStatus];

export const StockActionType = {
  IN: 'IN',
  OUT: 'OUT',
  ADJUST: 'ADJUST',
} as const;
export type StockActionType = (typeof StockActionType)[keyof typeof StockActionType];

export const EquipmentStatus = {
  NORMAL: 'NORMAL',
  MAINTENANCE: 'MAINTENANCE',
  BROKEN: 'BROKEN',
  SCRAPPED: 'SCRAPPED',
} as const;
export type EquipmentStatus = (typeof EquipmentStatus)[keyof typeof EquipmentStatus];

export const ProcessingOrderStatus = {
  DRAFT: 'DRAFT',
  SENT: 'SENT',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  RECEIVED: 'RECEIVED',
  CANCELLED: 'CANCELLED',
} as const;
export type ProcessingOrderStatus = (typeof ProcessingOrderStatus)[keyof typeof ProcessingOrderStatus];

export const BackupStatus = {
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
  VERIFYING: 'VERIFYING',
} as const;
export type BackupStatus = (typeof BackupStatus)[keyof typeof BackupStatus];

export const RiskLevel = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  EXTREME: 'EXTREME',
} as const;
export type RiskLevel = (typeof RiskLevel)[keyof typeof RiskLevel];

export const SyncOperation = {
  INSERT: 'INSERT',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
} as const;
export type SyncOperation = (typeof SyncOperation)[keyof typeof SyncOperation];

// ---------------------------------------------------------------------------
// Identity and clinic
// ---------------------------------------------------------------------------

export interface Clinic extends Entity {
  code: string;
  name: string;
  address?: string;
  phone?: string;
  active: boolean;
}

export interface User extends Entity, SoftDeletable {
  username: string;
  passwordHash: string;
  name: string;
  role: UserRole;
  currentClinicId?: ID | null;
  phone?: string;
  active: boolean;
  loginAttempts: number;
  lockedUntil?: UTCDateTime | null;
  tokenVersion: number;
}

export interface SessionClaims {
  userId: ID;
  clinicId: ID | null;
  role: UserRole;
  tokenVersion: number;
}

// ---------------------------------------------------------------------------
// Patient domain
// ---------------------------------------------------------------------------

export interface FamilyMember {
  id: ID;
  patientId: ID;
  name: string;
  relationship: string;
  phone?: string;
}

export interface Patient extends Entity, SoftDeletable {
  code: string;
  name: string;
  gender: Gender;
  phone: string;
  birthDate?: ClinicDate | null;
  idCard?: string;
  address?: string;
  occupation?: string;
  remark?: string;
  avatar?: string;
  tags: string[];
  allergies: string[];
  medicalHistory: string[];
  medicationHistory: string[];
  systemicDiseases: string[];
  source: PatientSource;
  active: boolean;
}

export interface PatientRiskScore extends Entity, SoftDeletable {
  patientId: ID;
  cariesScore: number;
  periodontalScore: number;
  implantScore: number;
  cariesLevel: RiskLevel;
  periodontalLevel: RiskLevel;
  implantLevel: RiskLevel;
  factorSnapshotJson: string;
  assessedById?: ID | null;
}

// ---------------------------------------------------------------------------
// Scheduling
// ---------------------------------------------------------------------------

export interface Chair extends Entity, SoftDeletable {
  name: string;
  location?: string;
  active: boolean;
}

export interface Appointment extends Entity, SoftDeletable {
  patientId: ID;
  doctorId: ID;
  chairId?: ID | null;
  startTime: UTCDateTime;
  endTime: UTCDateTime;
  status: AppointmentStatus;
  type: AppointmentType;
  remark?: string;
  visitId?: ID | null;
}

export interface Registration extends Entity, SoftDeletable {
  patientId: ID;
  doctorId?: ID | null;
  type: RegistrationType;
  status: RegistrationStatus;
  visitId?: ID | null;
  appointmentId?: ID | null;
  triageNote?: string;
  chiefComplaint?: string;
  registeredBy?: ID | null;
  registeredAt: UTCDateTime;
  triagedAt?: UTCDateTime | null;
  startedAt?: UTCDateTime | null;
  completedAt?: UTCDateTime | null;
}

export interface Visit extends Entity, SoftDeletable {
  patientId: ID;
  appointmentId?: ID | null;
  doctorId: ID;
  chiefComplaint?: string;
  diagnosis?: string;
  treatmentPlan?: string;
  summary?: string | null;
  startTime: UTCDateTime;
  endTime?: UTCDateTime | null;
  status: VisitStatus;
  nextReminder?: ClinicDate | null;
}

// ---------------------------------------------------------------------------
// Clinical records
// ---------------------------------------------------------------------------

export interface FirstExam extends Entity, SoftDeletable {
  patientId: ID;
  doctorId?: ID | null;
  consultantId?: ID | null;
  chiefComplaint?: string;
  presentIllness?: string;
  pastHistory?: string;
  oralExam?: string;
  auxiliaryExam?: string;
  diagnosis?: string;
  treatmentSuggestion?: string;
  status: string;
  remark?: string;
}

export interface FirstExamTooth {
  id: ID;
  examId: ID;
  toothNumber: number;
  toothStatus: string;
  diseases: string[];
  isChief: boolean;
  treatmentPlan?: string;
  remark?: string;
}

export interface OralExamination extends Entity, SoftDeletable {
  patientId: ID;
  examDate: ClinicDate;
  data: Record<string, unknown>;
  remark?: string;
}

export interface PeriodontalRecord extends Entity, SoftDeletable {
  patientId: ID;
  examDate: ClinicDate;
  data: Record<string, unknown>;
  plaqueIndex?: number | null;
  boneLoss?: string | null;
  remark?: string;
}

export interface MedicalRecord extends Entity, SoftDeletable {
  patientId: ID;
  visitId?: ID | null;
  doctorId?: ID | null;
  templateId?: ID | null;
  isTemplate: boolean;
  category?: string;
  chiefComplaint?: string;
  presentIllness?: string;
  pastHistory?: string;
  allergyHistory?: string;
  examination?: string;
  diagnosis?: string;
  treatmentPlan?: string;
  teethInvolved: string[];
  images: string[];
  isLocked: boolean;
  lockedAt?: UTCDateTime | null;
  lockedBy?: ID | null;
  signature?: string;
  status: string;
}

export interface ToothRecord extends Entity, SoftDeletable {
  patientId: ID;
  toothNumber: number;
  currentStatus: string;
  conditions: string[];
  remark?: string;
}

export interface Imaging extends Entity, SoftDeletable {
  patientId: ID;
  visitId?: ID | null;
  doctorId?: ID | null;
  type: string;
  title: string;
  description?: string;
  imageUrl: string;
  thumbnailUrl?: string;
  takenAt?: UTCDateTime | null;
  remark?: string;
}

// ---------------------------------------------------------------------------
// Treatment domain
// ---------------------------------------------------------------------------

export interface TreatmentCatalog extends Entity {
  code: string;
  name: string;
  category: string;
  price: Cents;
  remark?: string;
}

export interface Treatment extends Entity, SoftDeletable {
  patientId: ID;
  visitId?: ID | null;
  doctorId: ID;
  code: string;
  name: string;
  category: string;
  price: Cents;
  quantity: number;
  teethNumbers: string[];
  status: TreatmentStatus;
  plannedDate?: ClinicDate | null;
  completedDate?: ClinicDate | null;
  remark?: string;
}

export interface TreatmentPlan extends Entity, SoftDeletable {
  patientId: ID;
  visitId?: ID | null;
  doctorId: ID;
  name: string;
  status: string;
  totalFee: Cents;
  remark?: string;
}

export interface TreatmentPlanItem {
  id: ID;
  planId: ID;
  code: string;
  name: string;
  category: string;
  price: Cents;
  quantity: number;
  teethNumbers: string[];
  status: string;
  treatmentId?: ID | null;
  completedAt?: UTCDateTime | null;
  remark?: string;
}

// ---------------------------------------------------------------------------
// Financial domain
// ---------------------------------------------------------------------------

export interface Charge extends Entity, SoftDeletable {
  patientId: ID;
  visitId?: ID | null;
  doctorId?: ID | null;
  number: string;
  totalAmount: Cents;
  paidAmount: Cents;
  refundedAmount: Cents;
  discount: Cents;
  status: ChargeStatus;
  payMethod?: PayMethod | null;
  paidAt?: UTCDateTime | null;
  remark?: string;
}

export interface ChargeItem {
  id: ID;
  chargeId: ID;
  treatmentId?: ID | null;
  name: string;
  category: string;
  price: Cents;
  quantity: number;
  teethNumbers: string[];
  subtotal: Cents;
}

export interface Debt extends Entity, SoftDeletable {
  chargeId: ID;
  patientId: ID;
  totalAmount: Cents;
  paidAmount: Cents;
  status: DebtStatus;
}

export interface MemberCard extends Entity {
  patientId: ID;
  cardNo: string;
  balance: Cents;
  totalRecharge: Cents;
  totalConsume: Cents;
  status: 'ACTIVE' | 'INACTIVE' | 'DISABLED' | 'FROZEN' | 'EXPIRED';
  points: number;
  totalPoints: number;
  level: 'NORMAL' | 'VIP' | 'SVIP';
}

export interface Refund extends Entity, SoftDeletable {
  chargeId: ID;
  patientId: ID;
  amount: Cents;
  reason?: string;
  operatorId?: ID | null;
  operatorName?: string;
}

// ---------------------------------------------------------------------------
// Pharmacy content
// ---------------------------------------------------------------------------

export interface DrugCatalogItem extends Entity {
  code: string;
  name: string;
  specification?: string;
  unit: string;
  price: Cents;
  category?: string;
  active: boolean;
}

export interface Prescription extends Entity, SoftDeletable {
  patientId: ID;
  visitId?: ID | null;
  doctorId: ID;
  remark?: string;
}

export interface PrescriptionItem {
  id: ID;
  prescriptionId: ID;
  drugId?: ID | null;
  name: string;
  specification?: string;
  dosage?: string;
  frequency?: string;
  days: number;
  quantity: number;
  price: Cents;
}

// ---------------------------------------------------------------------------
// Inventory and supply chain
// ---------------------------------------------------------------------------

export interface Supplier extends Entity, SoftDeletable {
  code?: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  address?: string;
  bankAccount?: string;
  remark?: string;
}

export interface InventoryItem extends Entity, SoftDeletable {
  code: string;
  name: string;
  spec?: string;
  category: string;
  unit: string;
  stock: number;
  minStock: number;
  price: Cents;
  supplierId?: ID | null;
  expireDate?: ClinicDate | null;
  location?: string;
  remark?: string;
}

export interface InventoryTransaction extends Entity, SoftDeletable {
  itemId: ID;
  type: StockActionType;
  quantity: number;
  beforeStock: number;
  afterStock: number;
  referenceType?: string;
  referenceId?: ID | null;
  operatorId?: ID | null;
  remark?: string;
}

export interface PurchaseOrder extends Entity, SoftDeletable {
  number: string;
  supplierId: ID;
  totalAmount: Cents;
  status: string;
  receivedAt?: UTCDateTime | null;
}

export interface PurchaseOrderItem {
  id: ID;
  orderId: ID;
  itemId?: ID | null;
  name: string;
  spec?: string;
  quantity: number;
  unitPrice: Cents;
  subtotal: Cents;
}

export interface ProcessingOrder extends Entity, SoftDeletable {
  patientId: ID;
  visitId?: ID | null;
  factoryId?: ID | null;
  doctorId?: ID | null;
  number: string;
  shade?: string;
  teethNumbers: string[];
  totalFee: Cents;
  status: ProcessingOrderStatus;
  chargeId?: ID | null;
  sentAt?: UTCDateTime | null;
  expectedAt?: ClinicDate | null;
  receivedAt?: UTCDateTime | null;
  deliveredAt?: UTCDateTime | null;
  remark?: string;
}

export interface ReplenishmentSuggestion extends Entity, SoftDeletable {
  inventoryId: ID;
  avgDailyConsumption: number;
  leadTimeDays: number;
  safetyFactor: number;
  rop: number;
  suggestedQty: number;
  calculationSnapshotJson: string;
  status: 'OPEN' | 'APPLIED' | 'IGNORED';
  reason: string;
  supplierId?: ID | null;
  totalAmount: Cents;
}

// ---------------------------------------------------------------------------
// Communication and follow-up
// ---------------------------------------------------------------------------

export interface FollowUp extends Entity, SoftDeletable {
  patientId: ID;
  planDate: ClinicDate;
  content?: string;
  status: FollowUpStatus;
  result?: string;
  assigneeId?: ID | null;
  templateId?: ID | null;
  completedAt?: UTCDateTime | null;
}

export interface FollowUpTemplate extends Entity {
  name: string;
  triggerTreatmentCodes: string[];
  triggerTreatmentCategories: string[];
  minIntervalDays: number;
  recommendedIntervalDays: number;
  maxIntervalDays: number;
  riskMultiplierLow: number;
  riskMultiplierMedium: number;
  riskMultiplierHigh: number;
  riskMultiplierExtreme: number;
  requiresAdherenceCheck: boolean;
}

export interface FollowUpAssignment extends Entity, SoftDeletable {
  patientId: ID;
  followUpId?: ID | null;
  templateId?: ID | null;
  recommendedDate?: ClinicDate | null;
  actualDate?: ClinicDate | null;
  reason?: string;
  confidence: number;
  createdBy?: ID | null;
}

export interface WechatMessage extends Entity {
  patientId: ID;
  type: string;
  content?: string;
  status: string;
  templateId?: ID | null;
  sentAt?: UTCDateTime | null;
  result?: string;
  remark?: string;
}

export interface SatisfactionSurvey extends Entity {
  patientId?: ID | null;
  doctorId?: ID | null;
  score: number;
  channel: string;
  comment?: string;
  surveyDate: ClinicDate;
}

// ---------------------------------------------------------------------------
// HR, equipment, notifications
// ---------------------------------------------------------------------------

export interface WorkSchedule extends Entity {
  userId: ID;
  startTime: UTCDateTime;
  endTime: UTCDateTime;
  type: string;
  remark?: string;
}

export interface Attendance extends Entity {
  userId: ID;
  workDate: ClinicDate;
  checkIn?: UTCDateTime | null;
  checkOut?: UTCDateTime | null;
  status: string;
}

export interface LeaveRequest extends Entity {
  userId: ID;
  startDate: ClinicDate;
  endDate: ClinicDate;
  type: string;
  reason?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
  reviewerId?: ID | null;
  reviewedAt?: UTCDateTime | null;
}

export interface Equipment extends Entity, SoftDeletable {
  name: string;
  model?: string;
  brand?: string;
  serialNumber?: string;
  category?: string;
  location?: string;
  purchasePrice?: Cents;
  purchaseDate?: ClinicDate | null;
  supplier?: string;
  status: EquipmentStatus;
  remarks?: string;
}

export interface Notification extends Entity {
  userId: ID;
  title: string;
  body: string;
  kind: string;
  readAt?: UTCDateTime | null;
}

// ---------------------------------------------------------------------------
// System
// ---------------------------------------------------------------------------

export interface Setting {
  key: string;
  clinicId?: ID | null;
  value: string;
  updatedAt: UTCDateTime;
}

export interface OperationLog extends Entity {
  userId?: ID | null;
  userName?: string;
  action: string;
  target?: string;
  detail?: string;
  ip?: string;
  traceId?: string;
}

export interface BusinessAlert extends Entity {
  level: 'INFO' | 'WARNING' | 'CRITICAL';
  title: string;
  message: string;
  source: string;
  status: 'OPEN' | 'ACKNOWLEDGED' | 'RESOLVED';
  acknowledgedBy?: ID | null;
  acknowledgedAt?: UTCDateTime | null;
}

export interface BackupRecord {
  id: ID;
  filename: string;
  fileSize: number;
  type: string;
  status: BackupStatus;
  remark?: string;
  createdAt: UTCDateTime;
}

export interface SyncChange extends Entity {
  tableName: string;
  recordId: ID;
  operation: SyncOperation;
  deviceId: string;
}

// ---------------------------------------------------------------------------
// Use case and repository ports
// ---------------------------------------------------------------------------

export interface AppContext {
  userId: ID;
  clinicId: ID | null;
  role: UserRole;
  traceId: string;
  now: () => Date;
}

export interface IRepository<TEntity> {
  findById(id: ID, context: AppContext): Promise<TEntity | null>;
  findMany(query: RepositoryQuery, context: AppContext): Promise<Page<TEntity>>;
  insert(entity: TEntity, context: AppContext): Promise<void>;
  update(entity: TEntity, context: AppContext): Promise<void>;
  softDelete(id: ID, context: AppContext): Promise<void>;
}

export interface RepositoryQuery extends PageQuery {
  filters?: Record<string, unknown>;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
}

export interface IUnitOfWork {
  run<T>(fn: () => T): T;
}

// ---------------------------------------------------------------------------
// Generic resource definition
// ---------------------------------------------------------------------------

export type FieldType =
  | 'text'
  | 'longText'
  | 'number'
  | 'money'
  | 'date'
  | 'datetime'
  | 'boolean'
  | 'enum'
  | 'json'
  | 'relation';

export type FieldFormat =
  | 'text'
  | 'money'
  | 'date'
  | 'datetime'
  | 'json';

export type FieldInputType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'select'
  | 'checkbox'
  | 'json';

export interface ResourceField {
  name: string;
  type: FieldType;
  required?: boolean;
  unique?: boolean;
  searchable?: boolean;
  sortable?: boolean;
  label?: string;
  enumLabels?: Readonly<Record<string, string>>;
  format?: FieldFormat;
  inputType?: FieldInputType;
  hidden?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  helpText?: string;
  enumValues?: readonly string[];
  relation?: { resource: string; foreignKey: string; labelField: string };
  default?: unknown;
  min?: number;
  max?: number;
  maxLength?: number;
}

export interface ResourceCapabilities {
  list: boolean;
  create: boolean;
  update: boolean;
  delete: boolean;
  softDelete: boolean;
}

export interface ResourceDefinition {
  name: string;
  label?: string;
  table: string;
  fields: ResourceField[];
  searchableFields?: string[];
  defaultSort?: { field: string; order: 'ASC' | 'DESC' };
  capabilities: ResourceCapabilities;
  roles: UserRole[];
  audit?: boolean;
}

export interface ResourceRegistry {
  get(name: string): ResourceDefinition | undefined;
  all(): ResourceDefinition[];
}
