/**
 * 共享枚举定义（前后端通用）
 *
 * 采用 `const` 对象 + `as const` 模式：既保留运行时值（前端可用于下拉、映射），
 * 又能推导出字面量联合类型（后端 DTO / 前端类型校验均可使用）。
 *
 * 本文件为项目枚举的唯一来源，API 层直接通过 `@dental/shared` 消费。
 */

export const Role = {
  BOSS: 'BOSS',
  DOCTOR: 'DOCTOR',
  RECEPTIONIST: 'RECEPTIONIST',
  NURSE: 'NURSE',
  ADMIN: 'ADMIN',
} as const;
export type Role = typeof Role[keyof typeof Role];

export const Gender = {
  MALE: 'MALE',
  FEMALE: 'FEMALE',
  UNKNOWN: 'UNKNOWN',
  OTHER: 'OTHER',
} as const;
export type Gender = typeof Gender[keyof typeof Gender];

/**
 * 患者性别别名，与 Gender 完全等价，便于 DTO / 前端按业务语义使用。
 */
export const PatientGender = Gender;
export type PatientGender = typeof PatientGender[keyof typeof PatientGender];

export const PatientSource = {
  WALK_IN: 'WALK_IN',
  REFERRAL: 'REFERRAL',
  ONLINE: 'ONLINE',
  OTHER: 'OTHER',
} as const;
export type PatientSource = typeof PatientSource[keyof typeof PatientSource];

export const AppointmentStatus = {
  BOOKED: 'BOOKED',
  ARRIVED: 'ARRIVED',
  IN_CHAIR: 'IN_CHAIR',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
  NO_SHOW: 'NO_SHOW',
} as const;
export type AppointmentStatus = typeof AppointmentStatus[keyof typeof AppointmentStatus];

export const AppointmentType = {
  FIRST_VISIT: 'FIRST_VISIT',
  RETURN: 'RETURN',
  CONSULTATION: 'CONSULTATION',
  EMERGENCY: 'EMERGENCY',
  RECALL: 'RECALL',
  OTHER: 'OTHER',
} as const;
export type AppointmentType = typeof AppointmentType[keyof typeof AppointmentType];

export const VisitStatus = {
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type VisitStatus = typeof VisitStatus[keyof typeof VisitStatus];

export const ToothStatus = {
  SOUND: 'SOUND',
  FILLED: 'FILLED',
  CROWNED: 'CROWNED',
  MISSING: 'MISSING',
  IMPLANT: 'IMPLANT',
  BRIDGE: 'BRIDGE',
  ROOT_CANAL: 'ROOT_CANAL',
  EXTRACTED: 'EXTRACTED',
  DECAYED: 'DECAYED',
} as const;
export type ToothStatus = typeof ToothStatus[keyof typeof ToothStatus];

export const ToothCondition = {
  DECAY: 'DECAY',
  FILLING: 'FILLING',
  CROWN: 'CROWN',
  BRIDGE: 'BRIDGE',
  IMPLANT: 'IMPLANT',
  ROOT_CANAL: 'ROOT_CANAL',
  EXTRACTION: 'EXTRACTION',
  MOBILITY: 'MOBILITY',
  CALCULUS: 'CALCULUS',
  BLEEDING: 'BLEEDING',
  FURCATION: 'FURCATION',
  OTHER: 'OTHER',
} as const;
export type ToothCondition = typeof ToothCondition[keyof typeof ToothCondition];

export const TreatmentStatus = {
  PLANNED: 'PLANNED',
  APPROVED: 'APPROVED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type TreatmentStatus = typeof TreatmentStatus[keyof typeof TreatmentStatus];

export const FollowUpStatus = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type FollowUpStatus = typeof FollowUpStatus[keyof typeof FollowUpStatus];

export const ChargeStatus = {
  UNPAID: 'UNPAID',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
} as const;
export type ChargeStatus = typeof ChargeStatus[keyof typeof ChargeStatus];

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
export type PayMethod = typeof PayMethod[keyof typeof PayMethod];

export const PlanStatus = {
  DRAFT: 'DRAFT',
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type PlanStatus = typeof PlanStatus[keyof typeof PlanStatus];

export const PlanItemStatus = {
  PENDING: 'PENDING',
  PLANNED: 'PLANNED',
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED',
  SKIPPED: 'SKIPPED',
} as const;
export type PlanItemStatus = typeof PlanItemStatus[keyof typeof PlanItemStatus];

export const ImagingType = {
  PANORAMIC: 'PANORAMIC',
  PERIAPICAL: 'PERIAPICAL',
  BITEWING: 'BITEWING',
  CBCT: 'CBCT',
  INTRAORAL: 'INTRAORAL',
  EXTRAORAL: 'EXTRAORAL',
  CEPHALOMETRIC: 'CEPHALOMETRIC',
  OTHER: 'OTHER',
} as const;
export type ImagingType = typeof ImagingType[keyof typeof ImagingType];

export const RegistrationType = {
  FIRST_VISIT: 'FIRST_VISIT',
  RETURN_VISIT: 'RETURN_VISIT',
  EMERGENCY: 'EMERGENCY',
  WALK_IN: 'WALK_IN',
  APPOINTMENT: 'APPOINTMENT',
  FOLLOW_UP: 'FOLLOW_UP',
} as const;
export type RegistrationType = typeof RegistrationType[keyof typeof RegistrationType];

export const RegistrationStatus = {
  PENDING: 'PENDING',
  REGISTERED: 'REGISTERED',
  TRIAGED: 'TRIAGED',
  IN_PROGRESS: 'IN_PROGRESS',
  VISITING: 'VISITING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
} as const;
export type RegistrationStatus = typeof RegistrationStatus[keyof typeof RegistrationStatus];

export const DebtStatus = {
  UNPAID: 'UNPAID',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
} as const;
export type DebtStatus = typeof DebtStatus[keyof typeof DebtStatus];

export const StockActionType = {
  IN: 'IN',
  OUT: 'OUT',
  ADJUST: 'ADJUST',
} as const;
export type StockActionType = typeof StockActionType[keyof typeof StockActionType];
