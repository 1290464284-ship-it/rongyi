import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { centsToYuanString, toCents } from './format';

// 与服务端 src/server/application/service-modules/common.ts 的 MAX_MONEY_CENTS 保持一致。
const MAX_MONEY_CENTS = 1_000_000_000_000;
const MAX_MONEY_YUAN = MAX_MONEY_CENTS / 100;

describe('金额元分进位转换属性测试', () => {
  it('任意整数分 → 元字符串 → 解析回分 恒等（不丢精度）', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_MONEY_CENTS }), (cents) => {
        const yuanText = centsToYuanString(cents);
        expect(yuanText).toMatch(/^\d+\.\d{2}$/);
        expect(Math.round(Number(yuanText) * 100)).toBe(cents);
      }),
      { numRuns: 100 },
    );
  });

  it('任意两位小数金额（元）→ 分 → 元 往返恒等', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_MONEY_CENTS }), (cents) => {
        const yuan = cents / 100;
        expect(toCents(yuan)).toBe(cents);
        const yuanText = centsToYuanString(toCents(yuan));
        expect(Math.round(Number(yuanText) * 100)).toBe(cents);
      }),
      { numRuns: 100 },
    );
  });

  it('任意多位小数金额舍入到分：结果非负、安全整数、误差不超过半分且不越系统上限', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: MAX_MONEY_YUAN, noNaN: true, noDefaultInfinity: true }), (yuan) => {
        const cents = toCents(yuan);
        expect(Number.isSafeInteger(cents)).toBe(true);
        expect(cents).toBeGreaterThanOrEqual(0);
        expect(cents).toBeLessThanOrEqual(MAX_MONEY_CENTS);
        expect(Math.abs(cents - yuan * 100)).toBeLessThanOrEqual(0.5 + 1e-6);
      }),
      { numRuns: 100 },
    );
  });

  it('金额转分单调不减：元越大分越多', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: MAX_MONEY_YUAN, noNaN: true, noDefaultInfinity: true }),
        fc.double({ min: 0, max: MAX_MONEY_YUAN, noNaN: true, noDefaultInfinity: true }),
        (a, b) => {
          const [lo, hi] = a <= b ? [a, b] : [b, a];
          expect(toCents(lo)).toBeLessThanOrEqual(toCents(hi));
        },
      ),
      { numRuns: 100 },
    );
  });
});
