import {
  ChargeStatusMachine,
  ChargeStatusValue,
  InvalidChargeStatusTransitionError,
} from "./charge-status-machine";

describe("ChargeStatusMachine", () => {
  describe("状态定义", () => {
    it("应包含所有有效状态", () => {
      expect(ChargeStatusMachine.STATUS.UNPAID).toBe("UNPAID");
      expect(ChargeStatusMachine.STATUS.PARTIAL).toBe("PARTIAL");
      expect(ChargeStatusMachine.STATUS.PAID).toBe("PAID");
      expect(ChargeStatusMachine.STATUS.REFUNDED).toBe("REFUNDED");
      expect(ChargeStatusMachine.STATUS.CANCELLED).toBe("CANCELLED");
    });
  });

  describe("canTransition", () => {
    it("UNPAID 可转向 PARTIAL、PAID、CANCELLED", () => {
      expect(ChargeStatusMachine.canTransition("UNPAID", "PARTIAL")).toBe(true);
      expect(ChargeStatusMachine.canTransition("UNPAID", "PAID")).toBe(true);
      expect(ChargeStatusMachine.canTransition("UNPAID", "CANCELLED")).toBe(true);
      expect(ChargeStatusMachine.canTransition("UNPAID", "REFUNDED")).toBe(false);
    });

    it("PARTIAL 可转向 PAID、PARTIAL、CANCELLED", () => {
      expect(ChargeStatusMachine.canTransition("PARTIAL", "PAID")).toBe(true);
      expect(ChargeStatusMachine.canTransition("PARTIAL", "PARTIAL")).toBe(true);
      expect(ChargeStatusMachine.canTransition("PARTIAL", "CANCELLED")).toBe(true);
      expect(ChargeStatusMachine.canTransition("PARTIAL", "UNPAID")).toBe(false);
    });

    it("PAID 可转向 REFUNDED 或保持 PAID", () => {
      expect(ChargeStatusMachine.canTransition("PAID", "REFUNDED")).toBe(true);
      expect(ChargeStatusMachine.canTransition("PAID", "PAID")).toBe(true);
      expect(ChargeStatusMachine.canTransition("PAID", "UNPAID")).toBe(false);
    });

    it("REFUNDED 与 CANCELLED 只能保持自身", () => {
      expect(ChargeStatusMachine.canTransition("REFUNDED", "REFUNDED")).toBe(true);
      expect(ChargeStatusMachine.canTransition("REFUNDED", "PAID")).toBe(false);
      expect(ChargeStatusMachine.canTransition("CANCELLED", "CANCELLED")).toBe(true);
      expect(ChargeStatusMachine.canTransition("CANCELLED", "PAID")).toBe(false);
    });

    it("未知状态不可转换", () => {
      expect(ChargeStatusMachine.canTransition("UNKNOWN", "PAID")).toBe(false);
    });
  });

  describe("transition", () => {
    it("合法转换不抛异常", () => {
      expect(() => ChargeStatusMachine.transition("UNPAID", "PAID")).not.toThrow();
    });

    it("非法转换抛出 InvalidChargeStatusTransitionError", () => {
      expect(() => ChargeStatusMachine.transition("PAID", "UNPAID")).toThrow(
        InvalidChargeStatusTransitionError,
      );
      expect(() => ChargeStatusMachine.transition("PAID", "UNPAID")).toThrow(
        "非法的收费单状态转换: PAID -> UNPAID",
      );
    });
  });

  describe("getAllowedTransitions", () => {
    it("应返回指定状态允许的目标状态", () => {
      expect(ChargeStatusMachine.getAllowedTransitions("UNPAID")).toEqual([
        ChargeStatusValue.PARTIAL,
        ChargeStatusValue.PAID,
        ChargeStatusValue.CANCELLED,
      ]);
      expect(ChargeStatusMachine.getAllowedTransitions("REFUNDED")).toEqual([
        ChargeStatusValue.REFUNDED,
      ]);
    });

    it("未知状态返回空数组", () => {
      expect(ChargeStatusMachine.getAllowedTransitions("UNKNOWN")).toEqual([]);
    });
  });

  describe("resolveByPayment", () => {
    it("未付款时返回 UNPAID", () => {
      expect(ChargeStatusMachine.resolveByPayment(0, 100)).toBe("UNPAID");
      expect(ChargeStatusMachine.resolveByPayment(-10, 100)).toBe("UNPAID");
    });

    it("全额付款时返回 PAID", () => {
      expect(ChargeStatusMachine.resolveByPayment(100, 100)).toBe("PAID");
      expect(ChargeStatusMachine.resolveByPayment(120, 100)).toBe("PAID");
    });

    it("部分付款时返回 PARTIAL", () => {
      expect(ChargeStatusMachine.resolveByPayment(50, 100)).toBe("PARTIAL");
      expect(ChargeStatusMachine.resolveByPayment(0.01, 100)).toBe("PARTIAL");
    });
  });

  describe("resolveByRefund", () => {
    it("退款金额大于等于已付金额时返回 REFUNDED", () => {
      expect(ChargeStatusMachine.resolveByRefund(100, 100, "PAID")).toBe("REFUNDED");
      expect(ChargeStatusMachine.resolveByRefund(100, 120, "PAID")).toBe("REFUNDED");
      expect(ChargeStatusMachine.resolveByRefund(100, 100, "PARTIAL")).toBe("REFUNDED");
    });

    it("部分退款时保持原支付状态", () => {
      expect(ChargeStatusMachine.resolveByRefund(100, 30, "PAID")).toBe("PAID");
      expect(ChargeStatusMachine.resolveByRefund(100, 30, "PARTIAL")).toBe("PARTIAL");
    });
  });
});
