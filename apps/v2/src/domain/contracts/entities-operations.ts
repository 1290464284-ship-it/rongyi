// 运营/通信/系统实体（M-04：由 entities.ts 拆分）
import type { Entity, SoftDeletable, ID, UTCDateTime, ClinicDate, Cents } from './shared';
import type { FollowUpStatus, EquipmentStatus, BackupStatus, SyncOperation } from './enums';

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
