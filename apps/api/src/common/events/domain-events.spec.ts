import {
  ChargeCreatedEvent,
  ChargePaidEvent,
  ChargeRefundedEvent,
  ChargeCancelledEvent,
  RefundCreatedEvent,
  PatientCreatedEvent,
  PatientUpdatedEvent,
  PatientRegisteredEvent,
  AppointmentCreatedEvent,
  AppointmentUpdatedEvent,
  AppointmentCancelledEvent,
  AppointmentDeletedEvent,
  InventoryStockChangedEvent,
  MemberCardBalanceChangedEvent,
  MemberCardRechargedEvent,
  MemberCardConsumedEvent,
  UserRolesChangedEvent,
  EventNames,
} from './domain-events';

describe('domain-events 领域事件定义', () => {
  // ==================== 基础事件属性 ====================

  describe('DomainEvent 基类', () => {
    it('所有事件应有 eventName、timestamp、clinicId、userId', () => {
      const event = new ChargeCreatedEvent('c-1', 'p-1', 1000, 'clinic-1', 'user-1');
      expect(event.eventName).toBe('charge.created');
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.clinicId).toBe('clinic-1');
      expect(event.userId).toBe('user-1');
    });

    it('clinicId 和 userId 默认为 null', () => {
      const event = new ChargeCreatedEvent('c-1', 'p-1', 1000);
      expect(event.clinicId).toBeNull();
      expect(event.userId).toBeNull();
    });
  });

  // ==================== 收费事件 ====================

  describe('收费事件', () => {
    it('ChargeCreatedEvent 应携带 chargeId/patientId/totalAmount', () => {
      const e = new ChargeCreatedEvent('c-1', 'p-1', 5000, 'cl', 'u');
      expect(e.eventName).toBe('charge.created');
      expect(e.chargeId).toBe('c-1');
      expect(e.patientId).toBe('p-1');
      expect(e.totalAmount).toBe(5000);
    });

    it('ChargePaidEvent 应携带 paidAmount', () => {
      const e = new ChargePaidEvent('c-1', 'p-1', 3000, 'cl');
      expect(e.eventName).toBe('charge.paid');
      expect(e.paidAmount).toBe(3000);
    });

    it('ChargeRefundedEvent 应携带 refundAmount', () => {
      const e = new ChargeRefundedEvent('c-1', 'p-1', 1000);
      expect(e.eventName).toBe('charge.refunded');
      expect(e.refundAmount).toBe(1000);
    });

    it('ChargeCancelledEvent 应携带 totalAmount', () => {
      const e = new ChargeCancelledEvent('c-1', 'p-1', 2000);
      expect(e.eventName).toBe('charge.cancelled');
      expect(e.totalAmount).toBe(2000);
    });
  });

  // ==================== 退款事件 ====================

  describe('退款事件', () => {
    it('RefundCreatedEvent 应携带 refundId/chargeId/amount', () => {
      const e = new RefundCreatedEvent('r-1', 'c-1', 500, 'cl', 'u');
      expect(e.eventName).toBe('refund.created');
      expect(e.refundId).toBe('r-1');
      expect(e.chargeId).toBe('c-1');
      expect(e.amount).toBe(500);
    });
  });

  // ==================== 患者事件 ====================

  describe('患者事件', () => {
    it('PatientCreatedEvent', () => {
      const e = new PatientCreatedEvent('p-1', 'cl');
      expect(e.eventName).toBe('patient.created');
      expect(e.patientId).toBe('p-1');
    });

    it('PatientUpdatedEvent', () => {
      const e = new PatientUpdatedEvent('p-1', 'cl');
      expect(e.eventName).toBe('patient.updated');
    });

    it('PatientRegisteredEvent', () => {
      const e = new PatientRegisteredEvent('p-1', 'cl');
      expect(e.eventName).toBe('patient.registered');
    });
  });

  // ==================== 预约事件 ====================

  describe('预约事件', () => {
    it('AppointmentCreatedEvent 应携带 appointmentId/patientId/doctorId', () => {
      const e = new AppointmentCreatedEvent('a-1', 'p-1', 'd-1', 'cl');
      expect(e.eventName).toBe('appointment.created');
      expect(e.appointmentId).toBe('a-1');
      expect(e.doctorId).toBe('d-1');
    });

    it('AppointmentUpdatedEvent', () => {
      const e = new AppointmentUpdatedEvent('a-1', 'p-1', 'd-1');
      expect(e.eventName).toBe('appointment.updated');
    });

    it('AppointmentCancelledEvent', () => {
      const e = new AppointmentCancelledEvent('a-1', 'cl');
      expect(e.eventName).toBe('appointment.cancelled');
    });

    it('AppointmentDeletedEvent', () => {
      const e = new AppointmentDeletedEvent('a-1', 'p-1', 'd-1');
      expect(e.eventName).toBe('appointment.deleted');
    });
  });

  // ==================== 库存事件 ====================

  describe('库存事件', () => {
    it('InventoryStockChangedEvent 应携带 itemId/changeType/quantity', () => {
      const e = new InventoryStockChangedEvent('i-1', 'IN', 10, 'cl');
      expect(e.eventName).toBe('inventory.stock-changed');
      expect(e.changeType).toBe('IN');
      expect(e.quantity).toBe(10);
    });
  });

  // ==================== 会员卡事件 ====================

  describe('会员卡事件', () => {
    it('MemberCardBalanceChangedEvent', () => {
      const e = new MemberCardBalanceChangedEvent('mc-1', 'p-1', 'RECHARGE', 500, 1500, 'cl');
      expect(e.eventName).toBe('member-card.balance-changed');
      expect(e.changeType).toBe('RECHARGE');
      expect(e.balanceAfter).toBe(1500);
    });

    it('MemberCardRechargedEvent', () => {
      const e = new MemberCardRechargedEvent('mc-1', 'p-1', 1000, 2000);
      expect(e.eventName).toBe('member-card.recharged');
      expect(e.amount).toBe(1000);
    });

    it('MemberCardConsumedEvent', () => {
      const e = new MemberCardConsumedEvent('mc-1', 'p-1', 200, 800);
      expect(e.eventName).toBe('member-card.consumed');
      expect(e.balanceAfter).toBe(800);
    });
  });

  // ==================== 用户事件 ====================

  describe('用户事件', () => {
    it('UserRolesChangedEvent userId 应为构造参数', () => {
      const e = new UserRolesChangedEvent('u-1', 'cl');
      expect(e.eventName).toBe('user.roles-changed');
      expect(e.userId).toBe('u-1');
    });

    it('UserRolesChangedEvent 的 userId 字段应来自构造器第一个参数', () => {
      const e = new UserRolesChangedEvent('user-abc');
      expect(e.userId).toBe('user-abc');
    });
  });

  // ==================== EventNames 常量 ====================

  describe('EventNames 常量', () => {
    it('应包含所有已定义的事件名', () => {
      expect(EventNames.CHARGE_CREATED).toBe('charge.created');
      expect(EventNames.CHARGE_PAID).toBe('charge.paid');
      expect(EventNames.CHARGE_REFUNDED).toBe('charge.refunded');
      expect(EventNames.CHARGE_CANCELLED).toBe('charge.cancelled');
      expect(EventNames.PATIENT_CREATED).toBe('patient.created');
      expect(EventNames.PATIENT_UPDATED).toBe('patient.updated');
      expect(EventNames.APPOINTMENT_CREATED).toBe('appointment.created');
      expect(EventNames.APPOINTMENT_UPDATED).toBe('appointment.updated');
      expect(EventNames.APPOINTMENT_CANCELLED).toBe('appointment.cancelled');
      expect(EventNames.APPOINTMENT_DELETED).toBe('appointment.deleted');
      expect(EventNames.INVENTORY_STOCK_CHANGED).toBe('inventory.stock-changed');
      expect(EventNames.MEMBER_CARD_BALANCE_CHANGED).toBe('member-card.balance-changed');
      expect(EventNames.USER_ROLES_CHANGED).toBe('user.roles-changed');
    });

    it('EventNames 键数应正确', () => {
      expect(Object.keys(EventNames).length).toBe(13);
    });
  });
});
