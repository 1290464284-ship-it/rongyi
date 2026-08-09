// Enums（M-04：由 contracts.ts 拆分）

export const UserRole = {
  BOSS: 'BOSS',
  DOCTOR: 'DOCTOR',
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

export const PatientPreferredContact = {
  PHONE: 'PHONE',
  WECHAT: 'WECHAT',
  SMS: 'SMS',
  OTHER: 'OTHER',
} as const;
export type PatientPreferredContact = (typeof PatientPreferredContact)[keyof typeof PatientPreferredContact];

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
