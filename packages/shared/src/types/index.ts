
// 枚举类型从 ./enums 复用，避免与 enums.ts 重复导出同名类型
import type {
  AppointmentType,
  AppointmentStatus,
  VisitStatus,
  TreatmentStatus,
  ChargeStatus,
  Gender,
  PatientSource,
  FollowUpStatus,
  RegistrationStatus,
  RegistrationType,
  PayMethod,
} from '../enums';

// DB row type for better-sqlite3 compatibility
export type DbRow = Record<string, unknown>;

export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt?: string | null;
}

export interface Pagination<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export type UserRole = 'BOSS' | 'DOCTOR' | 'RECEPTIONIST' | 'NURSE' | 'ADMIN' | 'TECHNICIAN';

export interface User extends BaseEntity {
  [key: string]: unknown;
  username: string;
  passwordHash?: string;
  name: string;
  role: UserRole;
  phone?: string | null;
  active: number;
  loginAttempts?: number;
  lockedUntil?: string | null;
  tokenVersion?: number;
  refreshToken?: string | null;
  refreshTokenExpiresAt?: string | null;
}

export interface FamilyMember {
  [key: string]: unknown;
  id: string;
  name: string;
  code: string;
  phone: string;
  gender: string;
}

export interface Patient extends BaseEntity {
  [key: string]: unknown;
  code: string;
  name: string;
  gender: Gender;
  phone: string;
  birthDate?: string | null;
  idCard?: string | null;
  address?: string | null;
  occupation?: string | null;
  remark?: string | null;
  avatar?: string | null;
  tags: string[];
  allergies: string[];
  medicalHistory: string[];
  medicationHistory: string[];
  systemicDiseases: string[];
  source: PatientSource;
  familyId?: string | null;
  referrer?: string | null;
  emergencyContact?: string | null;
  emergencyPhone?: string | null;
  active: number;
  familyMembers?: FamilyMember[];
}

export interface Appointment extends BaseEntity {
  [key: string]: unknown;
  patientId: string;
  doctorId: string;
  chairId?: string | null;
  startTime: string;
  endTime: string;
  status: AppointmentStatus;
  type: AppointmentType;
  remark?: string | null;
  visitId?: string | null;
  deletedAt?: string | null;
}

export interface Visit extends BaseEntity {
  [key: string]: unknown;
  patientId: string;
  appointmentId?: string | null;
  doctorId: string;
  chiefComplaint?: string | null;
  diagnosis?: string | null;
  treatmentPlan?: string | null;
  startTime: string;
  endTime?: string | null;
  status: VisitStatus;
  deletedAt?: string | null;
}

export interface Treatment extends BaseEntity {
  [key: string]: unknown;
  patientId: string;
  visitId?: string | null;
  doctorId: string;
  code: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers: string[];
  status: TreatmentStatus;
  plannedDate?: string | null;
  completedDate?: string | null;
  remark?: string | null;
}

export interface TreatmentCatalog extends BaseEntity {
  code: string;
  name: string;
  category: string;
  price: number;
  remark?: string | null;
}

export interface Charge extends BaseEntity {
  [key: string]: unknown;
  patientId: string;
  visitId?: string | null;
  doctorId?: string | null;
  number: string;
  totalAmount: number;
  paidAmount: number;
  refundedAmount: number;
  discount: number;
  status: ChargeStatus;
  payMethod?: PayMethod | null;
  paidAt?: string | null;
  remark?: string | null;
  chargeId?: string;
  code?: string;
  isEnabled?: number;
  debtAmount?: number;
  parentId?: string | null;
  balance?: number;
  deletedAt?: string | null;
}

export type EquipmentStatus = 'NORMAL' | 'MAINTENANCE' | 'BROKEN' | 'SCRAPPED';

export interface Equipment extends BaseEntity {
  [key: string]: unknown;
  name: string;
  model?: string | null;
  brand?: string | null;
  serialNumber?: string | null;
  category?: string | null;
  location?: string | null;
  purchasePrice?: number | null;
  purchaseDate?: string | null;
  supplier?: string | null;
  status: EquipmentStatus;
  remarks?: string | null;
}

export { FollowUpStatus } from '../enums';

export interface FollowUp extends BaseEntity {
  [key: string]: unknown;
  patientId: string;
  planDate: string;
  content?: string | null;
  status: FollowUpStatus;
  result?: string | null;
  assigneeId?: string | null;
  completedAt?: string | null;
}

export interface Chair extends BaseEntity {
  [key: string]: unknown;
  name: string;
  location?: string | null;
  active: number;
}

export interface MemberCard extends BaseEntity {
  [key: string]: unknown;
  patientId: string;
  cardNo: string;
  balance: number;
  totalRecharge: number;
  totalConsume: number;
  status: 'ACTIVE' | 'INACTIVE' | 'DISABLED' | 'FROZEN' | 'EXPIRED';
  points: number;
  totalPoints: number;
  level: 'NORMAL' | 'VIP' | 'SVIP';
}

export interface Prescription extends BaseEntity {
  [key: string]: unknown;
  patientId: string;
  visitId?: string | null;
  doctorId: string;
  remark?: string | null;
}

export interface Imaging extends BaseEntity {
  [key: string]: unknown;
  patientId: string;
  visitId?: string | null;
  doctorId?: string | null;
  type: string;
  title: string;
  description?: string | null;
  imageUrl: string;
  thumbnailUrl?: string | null;
  takenAt?: string | null;
  remark?: string | null;
}

export interface Supplier extends BaseEntity {
  [key: string]: unknown;
  name: string;
  contactPerson?: string | null;
  phone?: string | null;
  address?: string | null;
  bankAccount?: string | null;
  remark?: string | null;
}

export interface InventoryItem extends BaseEntity {
  [key: string]: unknown;
  code: string;
  name: string;
  spec?: string | null;
  category: string;
  unit: string;
  stock: number;
  minStock: number;
  price: number;
  supplierId?: string | null;
  expireDate?: string | null;
  location?: string | null;
  remark?: string | null;
}

export interface Registration extends BaseEntity {
  [key: string]: unknown;
  patientId: string;
  doctorId?: string | null;
  type: RegistrationType;
  status: RegistrationStatus;
  visitId?: string | null;
  appointmentId?: string | null;
  triageNote?: string | null;
  chiefComplaint?: string | null;
  registeredBy?: string | null;
  registeredAt: string;
  triagedAt?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface OperationLog extends BaseEntity {
  [key: string]: unknown;
  userId?: string | null;
  userName?: string | null;
  action: string;
  target?: string | null;
  detail?: string | null;
  ip?: string | null;
}

export interface FirstExam extends BaseEntity {
  [key: string]: unknown;
  patientId: string;
  doctorId?: string | null;
  consultantId?: string | null;
  chiefComplaint?: string | null;
  presentIllness?: string | null;
  pastHistory?: string | null;
  oralExam?: string | null;
  auxiliaryExam?: string | null;
  diagnosis?: string | null;
  treatmentSuggestion?: string | null;
  status: string;
  remark?: string | null;
  deletedAt?: string | null;
}

export interface FirstExamTooth {
  [key: string]: unknown;
  id: string;
  examId: string;
  toothNumber: number;
  toothStatus: string;
  diseases: string[];
  isChief: number;
  treatmentPlan?: string | null;
  remark?: string | null;
}

export interface MedicalRecord extends BaseEntity {
  templateId?: string;
  isTemplate?: number;
  category?: string;
  [key: string]: unknown;
  patientId: string;
  visitId?: string | null;
  doctorId?: string | null;
  chiefComplaint?: string | null;
  presentIllness?: string | null;
  pastHistory?: string | null;
  allergyHistory?: string | null;
  examination?: string | null;
  diagnosis?: string | null;
  treatmentPlan?: string | null;
  teethInvolved?: string[];
  images?: string[];
  isLocked?: number;
  status: string;
  deletedAt?: string | null;
}

export interface ProcessingOrder extends BaseEntity {
  [key: string]: unknown;
  patientId: string;
  visitId?: string | null;
  factoryId?: string | null;
  doctorId?: string | null;
  number: string;
  shade?: string | null;
  teethNumbers: string[];
  totalFee: number;
  status: string;
  chargeId?: string | null;
  sentAt?: string | null;
  expectedAt?: string | null;
  receivedAt?: string | null;
  deliveredAt?: string | null;
  remark?: string | null;
  deletedAt?: string | null;
}

export interface ProcessingOrderItem {
  [key: string]: unknown;
  id: string;
  orderId: string;
  name: string;
  spec?: string | null;
  quantity: number;
  unitPrice: number;
  subtotal: number;
  status: string;
}

export interface BackupRecord {
  [key: string]: unknown;
  id: string;
  filename: string;
  fileSize: number;
  type: string;
  remark?: string | null;
  createdAt: string;
}

export interface WechatMessage extends BaseEntity {
  [key: string]: unknown;
  patientId: string;
  type: string;
  content?: string | null;
  status: string;
  templateId?: string | null;
  sentAt?: string | null;
  result?: string | null;
  remark?: string | null;
  name?: string | null;
  openId?: string | null;
}

export interface Refund extends BaseEntity {
  [key: string]: unknown;
  chargeId: string;
  patientId: string;
  amount: number;
  reason?: string | null;
  operatorId?: string | null;
  operatorName?: string | null;
  deletedAt?: string | null;
}

export interface SmsLog extends BaseEntity {
  [key: string]: unknown;
  patientId?: string | null;
  phone: string;
  content: string;
  type: string;
  status: string;
  result?: string | null;
  sentAt?: string | null;
  cost?: number;
}

export interface Invoice extends BaseEntity {
  [key: string]: unknown;
  chargeId: string;
  patientId: string;
  number: string;
  amount: number;
  type: string;
  status: string;
  issuedAt?: string | null;
  remark?: string | null;
}



// DB row types (runtime fields from database)
export interface ToothRecord extends BaseEntity {
  [key: string]: unknown;
  patientId: string;
  toothNumber: number;
  currentStatus: string;
  conditions: string[];
  remark?: string | null;
  deletedAt?: string | null;
}

export interface TreatmentPlan extends BaseEntity {
  [key: string]: unknown;
  patientId: string;
  visitId?: string | null;
  doctorId: string;
  name: string;
  status: string;
  totalFee: number;
  remark?: string | null;
  deletedAt?: string | null;
}

export interface TreatmentPlanItem {
  id: string;
  code: string;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers: string[];
  status: string;
  treatmentId?: string | null;
  completedAt?: string | null;
  remark?: string | null;
}

export interface ChargeItem {
  id: string;
  chargeId: string;
  treatmentId?: string | null;
  name: string;
  category: string;
  price: number;
  quantity: number;
  teethNumbers: string[];
  subtotal: number;
}

export const PATIENT_SOURCE_LABEL: Record<PatientSource, string> = {
  WALK_IN: '上门',
  REFERRAL: '转介绍',
  ONLINE: '线上',
  OTHER: '其他',
};

export const PATIENT_SOURCE_COLOR: Record<PatientSource, string> = {
  WALK_IN: 'bg-primary/10 text-primary',
  REFERRAL: 'bg-success/10 text-success',
  ONLINE: 'bg-info/10 text-info',
  OTHER: 'bg-muted text-muted-foreground',
};

export const APPOINTMENT_STATUS_LABEL: Record<AppointmentStatus, string> = {
  BOOKED: '已预约',
  ARRIVED: '已到店',
  IN_CHAIR: '就诊中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
  NO_SHOW: '爽约',
};

export const TREATMENT_STATUS_LABEL: Record<TreatmentStatus, string> = {
  PLANNED: '待执行',
  APPROVED: '已确认',
  IN_PROGRESS: '执行中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
};

export const CHARGE_STATUS_LABEL: Record<ChargeStatus, string> = {
  UNPAID: '未支付',
  PARTIAL: '部分支付',
  PAID: '已支付',
  REFUNDED: '已退款',
  CANCELLED: '已取消',
};

export const EQUIPMENT_STATUS_LABEL: Record<EquipmentStatus, string> = {
  NORMAL: '正常',
  MAINTENANCE: '维修中',
  BROKEN: '故障',
  SCRAPPED: '报废',
};

export const EQUIPMENT_STATUS_COLOR: Record<EquipmentStatus, string> = {
  NORMAL: 'bg-success/10 text-success',
  MAINTENANCE: 'bg-warning/10 text-warning',
  BROKEN: 'bg-destructive/10 text-destructive',
  SCRAPPED: 'bg-muted text-muted-foreground',
};

export const EQUIPMENT_CATEGORIES = [
  '电脑设备',
  '扫描仪',
  '打印机',
  '牙椅设备',
  'X光机',
  'CT机',
  '消毒设备',
  '空气净化',
  '办公家具',
  '其他',
];

// 离线同步相关类型
export type {
  SyncOperation,
  SyncChangeRecord,
  SyncPushChange,
  SyncPushPayload,
  SyncPullResult,
  SyncResult,
  SyncStatus,
} from './sync';
