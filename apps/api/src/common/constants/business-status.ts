/**
 * 业务状态枚举统一入口
 *
 * 1. 透传 @dental/shared 中已定义的状态枚举，避免各模块分散引用；
 * 2. 补充 shared 包未覆盖的项目内特有状态枚举（会员卡、病历修改申请、初诊等）。
 *
 * 新增枚举采用 `const` 对象 + `as const` 模式，与 @dental/shared 风格一致。
 * 枚举值必须与数据库中已落库的字符串完全一致，否则将导致历史数据无法匹配。
 */
export {
  TreatmentStatus,
  AppointmentStatus,
  VisitStatus,
  FollowUpStatus,
  PlanStatus,
  PlanItemStatus,
  RegistrationStatus,
} from '@dental/shared';

/**
 * 收费状态（补充 @dental/shared 中缺失的 CANCELLED）
 */
export const ChargeStatus = {
  UNPAID: 'UNPAID',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  REFUNDED: 'REFUNDED',
  CANCELLED: 'CANCELLED',
} as const;
// eslint-disable-next-line no-redeclare
export type ChargeStatus = typeof ChargeStatus[keyof typeof ChargeStatus];

/**
 * 欠费状态（补充 @dental/shared 中缺失的 CANCELLED）
 */
export const DebtStatus = {
  UNPAID: 'UNPAID',
  PARTIAL: 'PARTIAL',
  PAID: 'PAID',
  CANCELLED: 'CANCELLED',
} as const;
// eslint-disable-next-line no-redeclare
export type DebtStatus = typeof DebtStatus[keyof typeof DebtStatus];

/**
 * 退款状态
 */
export const RefundStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  COMPLETED: 'COMPLETED',
} as const;
// eslint-disable-next-line no-redeclare
export type RefundStatus = typeof RefundStatus[keyof typeof RefundStatus];

/**
 * 用户状态
 */
export const UserStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  LOCKED: 'LOCKED',
} as const;
// eslint-disable-next-line no-redeclare
export type UserStatus = typeof UserStatus[keyof typeof UserStatus];

/**
 * 患者状态
 */
export const PatientStatus = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  DELETED: 'DELETED',
} as const;
// eslint-disable-next-line no-redeclare
export type PatientStatus = typeof PatientStatus[keyof typeof PatientStatus];

/**
 * 会员卡状态
 */
export const MemberCardStatus = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  FROZEN: 'FROZEN',
  EXPIRED: 'EXPIRED',
} as const;
// eslint-disable-next-line no-redeclare
export type MemberCardStatus = typeof MemberCardStatus[keyof typeof MemberCardStatus];

/**
 * 病历修改申请状态
 */
export const ModifyRequestStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
// eslint-disable-next-line no-redeclare
export type ModifyRequestStatus = typeof ModifyRequestStatus[keyof typeof ModifyRequestStatus];

/**
 * 初诊状态
 */
export const FirstExamStatus = {
  DRAFT: 'DRAFT',
  SUBMITTED: 'SUBMITTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const;
// eslint-disable-next-line no-redeclare
export type FirstExamStatus = typeof FirstExamStatus[keyof typeof FirstExamStatus];

/**
 * 会员卡流水类型（MemberCardLog.type）
 */
export const MemberCardLogType = {
  RECHARGE: 'RECHARGE',
  CONSUME: 'CONSUME',
  REFUND: 'REFUND',
} as const;
// eslint-disable-next-line no-redeclare
export type MemberCardLogType = typeof MemberCardLogType[keyof typeof MemberCardLogType];

/**
 * 会员卡积分流水类型（MemberPointLog.type）
 */
export const PointLogType = {
  ADD: 'ADD',
  DEDUCT: 'DEDUCT',
} as const;
// eslint-disable-next-line no-redeclare
export type PointLogType = typeof PointLogType[keyof typeof PointLogType];
