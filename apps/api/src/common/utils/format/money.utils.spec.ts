import fc from 'fast-check';
import {
  yuanToCents,
  centsToYuan,
  addCents,
  subtractCents,
  multiplyCents,
  sumCents,
  centsGreaterThan,
  centsGreaterThanOrEqual,
  centsLessThan,
  centsLessThanOrEqual,
  centsEquals,
  formatCents,
  isValidMoneyAmount,
  MONEY_SCALE,
} from './money.utils';

describe('money.utils', () => {
  describe('yuanToCents', () => {
    it('应正确将元转换为分', () => {
      expect(yuanToCents(1)).toBe(100);
      expect(yuanToCents(10.5)).toBe(1050);
      expect(yuanToCents(0.01)).toBe(1);
      expect(yuanToCents(123.45)).toBe(12345);
    });

    it('应处理浮点精度问题', () => {
      expect(yuanToCents(0.1 + 0.2)).toBe(30);
      expect(yuanToCents(0.7 + 0.1)).toBe(80);
    });

    it('非数字输入应返回 0', () => {
      expect(yuanToCents(NaN)).toBe(0);
      expect(yuanToCents(Infinity)).toBe(0);
      expect(yuanToCents(-Infinity)).toBe(0);
      expect(yuanToCents(null as unknown as number)).toBe(0);
      expect(yuanToCents(undefined as unknown as number)).toBe(0);
      expect(yuanToCents('100' as unknown as number)).toBe(0);
    });

    it('应正确处理负数', () => {
      expect(yuanToCents(-10.5)).toBe(-1050);
      expect(yuanToCents(-0.01)).toBe(-1);
    });

    it('应正确处理零', () => {
      expect(yuanToCents(0)).toBe(0);
      expect(Object.is(yuanToCents(-0), -0)).toBe(true);
    });
  });

  describe('centsToYuan', () => {
    it('应正确将分转换为元', () => {
      expect(centsToYuan(100)).toBe(1);
      expect(centsToYuan(1050)).toBeCloseTo(10.5, 10);
      expect(centsToYuan(1)).toBeCloseTo(0.01, 10);
      expect(centsToYuan(12345)).toBeCloseTo(123.45, 10);
    });

    it('非数字输入应返回 0', () => {
      expect(centsToYuan(NaN)).toBe(0);
      expect(centsToYuan(Infinity)).toBe(0);
      expect(centsToYuan(-Infinity)).toBe(0);
    });

    it('应正确处理负数', () => {
      expect(centsToYuan(-1050)).toBeCloseTo(-10.5, 10);
    });

    it('应四舍五入到整数分', () => {
      expect(centsToYuan(100.5)).toBeCloseTo(1.01, 10);
      expect(centsToYuan(100.4)).toBe(1);
    });
  });

  describe('基本运算', () => {
    it('addCents 应正确相加', () => {
      expect(addCents(100, 200)).toBe(300);
      expect(addCents(-100, 200)).toBe(100);
      expect(addCents(0, 0)).toBe(0);
    });

    it('subtractCents 应正确相减', () => {
      expect(subtractCents(300, 200)).toBe(100);
      expect(subtractCents(100, 200)).toBe(-100);
      expect(subtractCents(0, 0)).toBe(0);
    });

    it('multiplyCents 应正确相乘并四舍五入', () => {
      expect(multiplyCents(100, 3)).toBe(300);
      expect(multiplyCents(10, 0.3)).toBe(3);
      expect(multiplyCents(1, 0.4)).toBe(0);
      expect(multiplyCents(1, 0.5)).toBe(1);
    });

    it('sumCents 应正确求和', () => {
      expect(sumCents([100, 200, 300])).toBe(600);
      expect(sumCents([])).toBe(0);
      expect(sumCents([-100, 200])).toBe(100);
    });
  });

  describe('比较运算', () => {
    it('centsGreaterThan 应正确比较', () => {
      expect(centsGreaterThan(200, 100)).toBe(true);
      expect(centsGreaterThan(100, 200)).toBe(false);
      expect(centsGreaterThan(100, 100)).toBe(false);
    });

    it('centsGreaterThanOrEqual 应正确比较', () => {
      expect(centsGreaterThanOrEqual(200, 100)).toBe(true);
      expect(centsGreaterThanOrEqual(100, 100)).toBe(true);
      expect(centsGreaterThanOrEqual(100, 200)).toBe(false);
    });

    it('centsLessThan 应正确比较', () => {
      expect(centsLessThan(100, 200)).toBe(true);
      expect(centsLessThan(200, 100)).toBe(false);
      expect(centsLessThan(100, 100)).toBe(false);
    });

    it('centsLessThanOrEqual 应正确比较', () => {
      expect(centsLessThanOrEqual(100, 200)).toBe(true);
      expect(centsLessThanOrEqual(100, 100)).toBe(true);
      expect(centsLessThanOrEqual(200, 100)).toBe(false);
    });

    it('centsEquals 应正确比较相等', () => {
      expect(centsEquals(100, 100)).toBe(true);
      expect(centsEquals(100, 200)).toBe(false);
      expect(centsEquals(-100, -100)).toBe(true);
    });
  });

  describe('formatCents', () => {
    it('应格式化为两位小数字符串', () => {
      expect(formatCents(100)).toBe('1.00');
      expect(formatCents(1050)).toBe('10.50');
      expect(formatCents(12345)).toBe('123.45');
      expect(formatCents(1)).toBe('0.01');
      expect(formatCents(0)).toBe('0.00');
    });

    it('应正确处理负数', () => {
      expect(formatCents(-1050)).toBe('-10.50');
    });
  });

  describe('isValidMoneyAmount', () => {
    it('应正确识别有效金额', () => {
      expect(isValidMoneyAmount(100)).toBe(true);
      expect(isValidMoneyAmount(0.01)).toBe(true);
      expect(isValidMoneyAmount(999999.99)).toBe(true);
    });

    it('应拒绝非数字输入', () => {
      expect(isValidMoneyAmount(null)).toBe(false);
      expect(isValidMoneyAmount(undefined)).toBe(false);
      expect(isValidMoneyAmount('100')).toBe(false);
      expect(isValidMoneyAmount({})).toBe(false);
      expect(isValidMoneyAmount([])).toBe(false);
    });

    it('应拒绝 NaN 和 Infinity', () => {
      expect(isValidMoneyAmount(NaN)).toBe(false);
      expect(isValidMoneyAmount(Infinity)).toBe(false);
      expect(isValidMoneyAmount(-Infinity)).toBe(false);
    });

    it('应拒绝零和负数', () => {
      expect(isValidMoneyAmount(0)).toBe(false);
      expect(isValidMoneyAmount(-1)).toBe(false);
      expect(isValidMoneyAmount(-0.01)).toBe(false);
    });
  });

  describe('MONEY_SCALE 常量', () => {
    it('应为 100', () => {
      expect(MONEY_SCALE).toBe(100);
    });
  });

  describe('属性测试 (fast-check)', () => {
    const safeInteger = fc.integer({ min: -1_000_000_000, max: 1_000_000_000 });

    it('yuanToCents(centsToYuan(cents)) === cents 对于整数分', () => {
      const property = fc.property(safeInteger, (cents) => {
        return yuanToCents(centsToYuan(cents)) === cents;
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('addCents(a, b) === a + b', () => {
      const property = fc.property(safeInteger, safeInteger, (a, b) => {
        return addCents(a, b) === a + b;
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('subtractCents(a, b) === a - b', () => {
      const property = fc.property(safeInteger, safeInteger, (a, b) => {
        return subtractCents(a, b) === a - b;
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('multiplyCents(priceCents, qty) === Math.round(priceCents * qty)', () => {
      const property = fc.property(
        safeInteger,
        fc.float({ noDefaultInfinity: true, noNaN: true, min: -1000, max: 1000 }),
        (priceCents, qty) => {
          return multiplyCents(priceCents, qty) === Math.round(priceCents * qty);
        }
      );
      expect(fc.assert(property)).toBe(undefined);
    });

    it('centsGreaterThan(a, b) === (a > b)', () => {
      const property = fc.property(safeInteger, safeInteger, (a, b) => {
        return centsGreaterThan(a, b) === a > b;
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('centsLessThan(a, b) === (a < b)', () => {
      const property = fc.property(safeInteger, safeInteger, (a, b) => {
        return centsLessThan(a, b) === a < b;
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('centsEquals(a, b) === (a === b)', () => {
      const property = fc.property(safeInteger, safeInteger, (a, b) => {
        return centsEquals(a, b) === (a === b);
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('formatCents 输出格式正确（两位小数）', () => {
      const property = fc.property(safeInteger, (cents) => {
        const result = formatCents(cents);
        return /^-?\d+\.\d{2}$/.test(result);
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('formatCents 输出值与输入对应：parseFloat(formatCents(c)) * 100 ≈ c', () => {
      const property = fc.property(safeInteger, (cents) => {
        const formatted = formatCents(cents);
        const parsed = parseFloat(formatted);
        return Math.round(parsed * 100) === cents;
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('addCents 交换律：addCents(a, b) === addCents(b, a)', () => {
      const property = fc.property(safeInteger, safeInteger, (x, y) => {
        const sum1 = addCents(x, y);
        const sum2 = addCents(y, x);
        return sum1 === sum2;
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('addCents 结合律：addCents(addCents(a, b), c) === addCents(a, addCents(b, c))', () => {
      const property = fc.property(safeInteger, safeInteger, safeInteger, (a, b, c) => {
        return addCents(addCents(a, b), c) === addCents(a, addCents(b, c));
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('subtractCents(a, a) === 0', () => {
      const property = fc.property(safeInteger, (a) => {
        return subtractCents(a, a) === 0;
      });
      expect(fc.assert(property)).toBe(undefined);
    });
  });
});
