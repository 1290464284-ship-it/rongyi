import { ChargeStatus } from "@dental/shared";
import {
  centsGreaterThanOrEqual,
  centsLessThanOrEqual,
  yuanToCents,
} from "../../../../common/utils/format/money.utils";

/**
 * 收费单状态值。
 *
 * 以 @dental/shared 的 ChargeStatus 为基础，同时包含数据库 schema 中允许的 CANCELLED。
 */
export const ChargeStatusValue = {
  ...ChargeStatus,
  CANCELLED: "CANCELLED",
} as const;

export class InvalidChargeStatusTransitionError extends Error {
  constructor(from: string, to: string) {
    super(`非法的收费单状态转换: ${from} -> ${to}`);
    this.name = "InvalidChargeStatusTransitionError";
  }
}

/**
 * 收费单状态机。
 *
 * 集中管理收费单的所有有效状态、允许的状态转换，以及由金额推导目标状态的业务规则。
 * 该状态机不依赖数据库，可单独测试。
 */
export class ChargeStatusMachine {
  static readonly STATUS = ChargeStatusValue;

  private static readonly allowedTransitions: Record<
    (typeof ChargeStatusValue)[keyof typeof ChargeStatusValue],
    (typeof ChargeStatusValue)[keyof typeof ChargeStatusValue][]
  > = {
    [ChargeStatusValue.UNPAID]: [
      ChargeStatusValue.PARTIAL,
      ChargeStatusValue.PAID,
      ChargeStatusValue.CANCELLED,
    ],
    [ChargeStatusValue.PARTIAL]: [
      ChargeStatusValue.PAID,
      ChargeStatusValue.PARTIAL,
      ChargeStatusValue.CANCELLED,
    ],
    [ChargeStatusValue.PAID]: [
      ChargeStatusValue.REFUNDED,
      ChargeStatusValue.PAID,
    ],
    [ChargeStatusValue.REFUNDED]: [ChargeStatusValue.REFUNDED],
    [ChargeStatusValue.CANCELLED]: [ChargeStatusValue.CANCELLED],
  };

  /**
   * 判断从 from 状态转换到 to 状态是否合法。
   */
  static canTransition(from: string, to: string): boolean {
    const allowed = ChargeStatusMachine.allowedTransitions[from as (typeof ChargeStatusValue)[keyof typeof ChargeStatusValue]];
    return !!allowed && allowed.includes(to as (typeof ChargeStatusValue)[keyof typeof ChargeStatusValue]);
  }

  /**
   * 执行状态转换校验。非法转换时抛出明确异常。
   */
  static transition(from: string, to: string): void {
    if (!ChargeStatusMachine.canTransition(from, to)) {
      throw new InvalidChargeStatusTransitionError(from, to);
    }
  }

  /**
   * 获取指定状态允许转换到的所有目标状态。
   */
  static getAllowedTransitions(from: string): (typeof ChargeStatusValue)[keyof typeof ChargeStatusValue][] {
    return ChargeStatusMachine.allowedTransitions[from as (typeof ChargeStatusValue)[keyof typeof ChargeStatusValue]] || [];
  }

  /**
   * 根据已付金额与总金额计算收费单应处的状态。
   *
   * 规则与原有 SQL CASE WHEN 保持一致：
   * - paid <= 0          -> UNPAID
   * - paid >= total      -> PAID
   * - 0 < paid < total   -> PARTIAL
   */
  static resolveByPayment(
    paidAmount: number,
    totalAmount: number,
  ): (typeof ChargeStatusValue)[keyof typeof ChargeStatusValue] {
    const paidCents = yuanToCents(paidAmount);
    const totalCents = yuanToCents(totalAmount);

    if (centsLessThanOrEqual(paidCents, 0)) {
      return ChargeStatusValue.UNPAID;
    }
    if (centsGreaterThanOrEqual(paidCents, totalCents)) {
      return ChargeStatusValue.PAID;
    }
    return ChargeStatusValue.PARTIAL;
  }

  /**
   * 根据退款金额计算收费单应处的状态。
   *
   * 规则与原有退款逻辑保持一致：
   * - 退款金额 >= 已付金额 -> REFUNDED
   * - 否则保持当前支付状态（PAID 或 PARTIAL）
   */
  static resolveByRefund(
    paidAmount: number,
    refundedAmount: number,
    currentStatus: string,
  ): (typeof ChargeStatusValue)[keyof typeof ChargeStatusValue] {
    const paidCents = yuanToCents(paidAmount);
    const refundedCents = yuanToCents(refundedAmount);

    if (centsGreaterThanOrEqual(refundedCents, paidCents)) {
      return ChargeStatusValue.REFUNDED;
    }
    return currentStatus as (typeof ChargeStatusValue)[keyof typeof ChargeStatusValue];
  }
}
