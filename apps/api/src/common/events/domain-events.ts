/**
 * 领域事件定义
 *
 * 所有领域事件均在此文件统一定义，供事件发布方（emit）和消费方（@OnEvent）使用。
 * 事件命名规范：'{领域}.{动作}'，如 'charge.created'、'patient.updated'。
 *
 * 设计原则：
 * - 事件是不可变的纯数据对象（readonly 字段）
 * - 事件携带最小必要上下文，消费方不应再回查数据库
 * - 事件名与 NestJS EventEmitter 的 event name 一一对应
 */

// ============================================================================
// 通用基础事件（所有领域事件继承）
// ============================================================================

export abstract class DomainEvent {
  abstract readonly eventName: string;
  readonly timestamp: Date;
  readonly clinicId: string | null;
  readonly userId: string | null;

  protected constructor(clinicId: string | null = null, userId: string | null = null) {
    this.timestamp = new Date();
    this.clinicId = clinicId;
    this.userId = userId;
  }
}

// ============================================================================
// 收费相关事件
// ============================================================================

export class ChargeCreatedEvent extends DomainEvent {
  readonly eventName = 'charge.created';
  constructor(
    public readonly chargeId: string,
    public readonly patientId: string,
    public readonly totalAmount: number,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

export class ChargePaidEvent extends DomainEvent {
  readonly eventName = 'charge.paid';
  constructor(
    public readonly chargeId: string,
    public readonly patientId: string,
    public readonly paidAmount: number,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

export class ChargeRefundedEvent extends DomainEvent {
  readonly eventName = 'charge.refunded';
  constructor(
    public readonly chargeId: string,
    public readonly patientId: string,
    public readonly refundAmount: number,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

export class ChargeCancelledEvent extends DomainEvent {
  readonly eventName = 'charge.cancelled';
  constructor(
    public readonly chargeId: string,
    public readonly patientId: string,
    public readonly totalAmount: number,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

// ============================================================================
// 退款相关事件
// ============================================================================

export class RefundCreatedEvent extends DomainEvent {
  readonly eventName = 'refund.created';
  constructor(
    public readonly refundId: string,
    public readonly chargeId: string,
    public readonly amount: number,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

// ============================================================================
// 患者相关事件
// ============================================================================

export class PatientCreatedEvent extends DomainEvent {
  readonly eventName = 'patient.created';
  constructor(
    public readonly patientId: string,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

export class PatientUpdatedEvent extends DomainEvent {
  readonly eventName = 'patient.updated';
  constructor(
    public readonly patientId: string,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

export class PatientRegisteredEvent extends DomainEvent {
  readonly eventName = 'patient.registered';
  constructor(
    public readonly patientId: string,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

// ============================================================================
// 预约相关事件
// ============================================================================

export class AppointmentCreatedEvent extends DomainEvent {
  readonly eventName = 'appointment.created';
  constructor(
    public readonly appointmentId: string,
    public readonly patientId: string,
    public readonly doctorId: string,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

export class AppointmentUpdatedEvent extends DomainEvent {
  readonly eventName = 'appointment.updated';
  constructor(
    public readonly appointmentId: string,
    public readonly patientId: string,
    public readonly doctorId: string,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

export class AppointmentCancelledEvent extends DomainEvent {
  readonly eventName = 'appointment.cancelled';
  constructor(
    public readonly appointmentId: string,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

export class AppointmentDeletedEvent extends DomainEvent {
  readonly eventName = 'appointment.deleted';
  constructor(
    public readonly appointmentId: string,
    public readonly patientId: string,
    public readonly doctorId: string,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

// ============================================================================
// 库存相关事件
// ============================================================================

export class InventoryStockChangedEvent extends DomainEvent {
  readonly eventName = 'inventory.stock-changed';
  constructor(
    public readonly itemId: string,
    public readonly changeType: 'IN' | 'OUT' | 'ADJUST',
    public readonly quantity: number,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

// ============================================================================
// 会员卡相关事件
// ============================================================================

export class MemberCardBalanceChangedEvent extends DomainEvent {
  readonly eventName = 'member-card.balance-changed';
  constructor(
    public readonly cardId: string,
    public readonly patientId: string,
    public readonly changeType: 'RECHARGE' | 'CONSUME' | 'REFUND',
    public readonly amount: number,
    public readonly balanceAfter: number,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

export class MemberCardRechargedEvent extends DomainEvent {
  readonly eventName = 'member-card.recharged';
  constructor(
    public readonly cardId: string,
    public readonly patientId: string,
    public readonly amount: number,
    public readonly balanceAfter: number,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

export class MemberCardConsumedEvent extends DomainEvent {
  readonly eventName = 'member-card.consumed';
  constructor(
    public readonly cardId: string,
    public readonly patientId: string,
    public readonly amount: number,
    public readonly balanceAfter: number,
    clinicId: string | null = null,
    userId: string | null = null,
  ) {
    super(clinicId, userId);
  }
}

// ============================================================================
// 用户/权限相关事件
// ============================================================================

export class UserRolesChangedEvent extends DomainEvent {
  readonly eventName = 'user.roles-changed';
  constructor(
    public readonly userId: string,
    clinicId: string | null = null,
  ) {
    super(clinicId, null);
  }
}

// ============================================================================
// 事件名称常量（用于 @OnEvent 装饰器）
// ============================================================================

export const EventNames = {
  CHARGE_CREATED: 'charge.created',
  CHARGE_PAID: 'charge.paid',
  CHARGE_REFUNDED: 'charge.refunded',
  CHARGE_CANCELLED: 'charge.cancelled',
  PATIENT_CREATED: 'patient.created',
  PATIENT_UPDATED: 'patient.updated',
  APPOINTMENT_CREATED: 'appointment.created',
  APPOINTMENT_UPDATED: 'appointment.updated',
  APPOINTMENT_CANCELLED: 'appointment.cancelled',
  APPOINTMENT_DELETED: 'appointment.deleted',
  INVENTORY_STOCK_CHANGED: 'inventory.stock-changed',
  MEMBER_CARD_BALANCE_CHANGED: 'member-card.balance-changed',
  USER_ROLES_CHANGED: 'user.roles-changed',
} as const;
