import { Money } from './money';

describe('Money', () => {
  describe('静态工厂方法', () => {
    it('fromYuan 应正确将元转换为分', () => {
      const money = Money.fromYuan(10.5);
      expect(money.toCents()).toBe(1050);
    });

    it('fromCents 应正确设置分值', () => {
      const money = Money.fromCents(1050);
      expect(money.toCents()).toBe(1050);
      expect(money.toYuan()).toBe(10.5);
    });
  });

  describe('基本运算', () => {
    it('add 应正确相加', () => {
      const a = Money.fromYuan(10.5);
      const b = Money.fromYuan(5.3);
      const result = a.add(b);
      expect(result.toYuan()).toBeCloseTo(15.8, 10);
      expect(result.toCents()).toBe(1580);
    });

    it('subtract 应正确相减', () => {
      const a = Money.fromYuan(10.5);
      const b = Money.fromYuan(5.3);
      const result = a.subtract(b);
      expect(result.toYuan()).toBeCloseTo(5.2, 10);
      expect(result.toCents()).toBe(520);
    });

    it('multiply 应正确相乘', () => {
      const money = Money.fromYuan(10.5);
      const result = money.multiply(3);
      expect(result.toYuan()).toBe(31.5);
      expect(result.toCents()).toBe(3150);
    });

    it('divide 应正确相除', () => {
      const money = Money.fromYuan(10.5);
      const result = money.divide(3);
      expect(result.toYuan()).toBe(3.5);
      expect(result.toCents()).toBe(350);
    });

    it('divide 除以零应抛出错误', () => {
      const money = Money.fromYuan(10.5);
      expect(() => money.divide(0)).toThrow('不能除以零');
    });

    it('运算应返回新 Money 对象，不可变', () => {
      const a = Money.fromYuan(10);
      const b = Money.fromYuan(5);
      const result = a.add(b);
      expect(result).not.toBe(a);
      expect(a.toYuan()).toBe(10);
      expect(b.toYuan()).toBe(5);
    });
  });

  describe('精度保护', () => {
    it('0.1 + 0.2 应等于 0.3（浮点精度问题）', () => {
      const a = Money.fromYuan(0.1);
      const b = Money.fromYuan(0.2);
      const result = a.add(b);
      expect(result.equals(Money.fromYuan(0.3))).toBe(true);
      expect(result.toYuan()).toBeCloseTo(0.3, 10);
    });

    it('0.7 + 0.1 应等于 0.8（浮点精度问题）', () => {
      const a = Money.fromYuan(0.7);
      const b = Money.fromYuan(0.1);
      const result = a.add(b);
      expect(result.equals(Money.fromYuan(0.8))).toBe(true);
    });

    it('多次累加不应出现精度误差', () => {
      let sum = Money.fromYuan(0);
      for (let i = 0; i < 100; i++) {
        sum = sum.add(Money.fromYuan(0.01));
      }
      expect(sum.equals(Money.fromYuan(1))).toBe(true);
      expect(sum.toYuan()).toBe(1);
    });

    it('乘法应正确四舍五入', () => {
      const money = Money.fromYuan(0.1);
      const result = money.multiply(0.3);
      expect(result.toCents()).toBe(3);
      expect(result.toYuan()).toBeCloseTo(0.03, 10);
    });

    it('乘法四舍五入到分', () => {
      const money = Money.fromYuan(0.01);
      const result = money.multiply(0.4);
      expect(result.toCents()).toBe(0);
    });
  });

  describe('比较运算', () => {
    it('equals 应正确比较相等', () => {
      const a = Money.fromYuan(10.5);
      const b = Money.fromYuan(10.5);
      const c = Money.fromYuan(10.51);
      expect(a.equals(b)).toBe(true);
      expect(a.equals(c)).toBe(false);
    });

    it('greaterThan 应正确比较大小', () => {
      const a = Money.fromYuan(10.5);
      const b = Money.fromYuan(5.3);
      expect(a.greaterThan(b)).toBe(true);
      expect(b.greaterThan(a)).toBe(false);
      expect(a.greaterThan(a)).toBe(false);
    });

    it('greaterThanOrEqual 应正确比较', () => {
      const a = Money.fromYuan(10.5);
      const b = Money.fromYuan(10.5);
      const c = Money.fromYuan(5.3);
      expect(a.greaterThanOrEqual(b)).toBe(true);
      expect(a.greaterThanOrEqual(c)).toBe(true);
      expect(c.greaterThanOrEqual(a)).toBe(false);
    });

    it('lessThan 应正确比较大小', () => {
      const a = Money.fromYuan(5.3);
      const b = Money.fromYuan(10.5);
      expect(a.lessThan(b)).toBe(true);
      expect(b.lessThan(a)).toBe(false);
      expect(a.lessThan(a)).toBe(false);
    });

    it('lessThanOrEqual 应正确比较', () => {
      const a = Money.fromYuan(5.3);
      const b = Money.fromYuan(5.3);
      const c = Money.fromYuan(10.5);
      expect(a.lessThanOrEqual(b)).toBe(true);
      expect(a.lessThanOrEqual(c)).toBe(true);
      expect(c.lessThanOrEqual(a)).toBe(false);
    });
  });

  describe('格式化输出', () => {
    it('format 应返回两位小数的字符串', () => {
      expect(Money.fromYuan(10).format()).toBe('10.00');
      expect(Money.fromYuan(10.5).format()).toBe('10.50');
      expect(Money.fromYuan(10.25).format()).toBe('10.25');
      expect(Money.fromYuan(0.01).format()).toBe('0.01');
    });

    it('toString 应返回带人民币符号的字符串', () => {
      expect(Money.fromYuan(10).toString()).toBe('¥10.00');
      expect(Money.fromYuan(10.5).toString()).toBe('¥10.50');
      expect(Money.fromYuan(123.45).toString()).toBe('¥123.45');
    });

    it('toYuan 应返回元为单位的数字', () => {
      expect(Money.fromCents(100).toYuan()).toBe(1);
      expect(Money.fromCents(1050).toYuan()).toBeCloseTo(10.5, 10);
      expect(Money.fromCents(12345).toYuan()).toBeCloseTo(123.45, 10);
    });

    it('toCents 应返回分为单位的整数', () => {
      expect(Money.fromYuan(1).toCents()).toBe(100);
      expect(Money.fromYuan(10.5).toCents()).toBe(1050);
      expect(Money.fromYuan(123.45).toCents()).toBe(12345);
    });
  });
});
