import { describe, it, expect } from 'vitest';
import {
  MONEY_SCALE,
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
  formatYuan,
  isValidMoneyAmount,
} from '../money';

describe('money validator', () => {
  describe('MONEY_SCALE', () => {
    it('should be 100', () => {
      expect(MONEY_SCALE).toBe(100);
    });
  });

  describe('yuanToCents', () => {
    it('should convert yuan to cents correctly', () => {
      expect(yuanToCents(1)).toBe(100);
      expect(yuanToCents(10.5)).toBe(1050);
      expect(yuanToCents(0.01)).toBe(1);
      expect(yuanToCents(0)).toBe(0);
    });

    it('should handle negative values', () => {
      expect(yuanToCents(-5)).toBe(-500);
      expect(yuanToCents(-0.01)).toBe(-1);
    });

    it('should return 0 for NaN', () => {
      expect(yuanToCents(NaN)).toBe(0);
    });

    it('should return 0 for Infinity', () => {
      expect(yuanToCents(Infinity)).toBe(0);
      expect(yuanToCents(-Infinity)).toBe(0);
    });

    it('should return 0 for non-number types', () => {
      expect(yuanToCents('100' as unknown as number)).toBe(0);
      expect(yuanToCents(null as unknown as number)).toBe(0);
      expect(yuanToCents(undefined as unknown as number)).toBe(0);
    });

    it('should round to avoid floating point errors', () => {
      expect(yuanToCents(0.1 + 0.2)).toBe(30);
      // 1.005 * 100 = 100.49999... in JS, rounds to 100
      expect(yuanToCents(1.005)).toBe(100);
      // 1.015 * 100 = 101.5, rounds to 102 but JS float = 101.4999...
      expect(yuanToCents(1.015)).toBe(101);
      expect(yuanToCents(2.5)).toBe(250);
    });
  });

  describe('centsToYuan', () => {
    it('should convert cents to yuan correctly', () => {
      expect(centsToYuan(100)).toBe(1);
      expect(centsToYuan(1050)).toBe(10.5);
      expect(centsToYuan(1)).toBe(0.01);
      expect(centsToYuan(0)).toBe(0);
    });

    it('should handle negative values', () => {
      expect(centsToYuan(-500)).toBe(-5);
      expect(centsToYuan(-1)).toBe(-0.01);
    });

    it('should return 0 for NaN', () => {
      expect(centsToYuan(NaN)).toBe(0);
    });

    it('should return 0 for Infinity', () => {
      expect(centsToYuan(Infinity)).toBe(0);
      expect(centsToYuan(-Infinity)).toBe(0);
    });

    it('should return 0 for non-number types', () => {
      expect(centsToYuan('100' as unknown as number)).toBe(0);
      expect(centsToYuan(null as unknown as number)).toBe(0);
    });

    it('should round cents to integer', () => {
      expect(centsToYuan(100.5)).toBe(1.01);
      expect(centsToYuan(99.4)).toBe(0.99);
    });
  });

  describe('arithmetic operations', () => {
    it('addCents should add two cent values', () => {
      expect(addCents(100, 200)).toBe(300);
      expect(addCents(0, 0)).toBe(0);
      expect(addCents(-100, 100)).toBe(0);
    });

    it('subtractCents should subtract two cent values', () => {
      expect(subtractCents(300, 100)).toBe(200);
      expect(subtractCents(100, 300)).toBe(-200);
      expect(subtractCents(0, 0)).toBe(0);
    });

    it('multiplyCents should multiply price by quantity', () => {
      expect(multiplyCents(1000, 3)).toBe(3000);
      expect(multiplyCents(100, 0)).toBe(0);
      expect(multiplyCents(999, 2)).toBe(1998);
    });

    it('sumCents should sum an array of cent values', () => {
      expect(sumCents([100, 200, 300])).toBe(600);
      expect(sumCents([])).toBe(0);
      expect(sumCents([100])).toBe(100);
    });
  });

  describe('comparison operations', () => {
    it('centsGreaterThan should compare correctly', () => {
      expect(centsGreaterThan(200, 100)).toBe(true);
      expect(centsGreaterThan(100, 200)).toBe(false);
      expect(centsGreaterThan(100, 100)).toBe(false);
    });

    it('centsGreaterThanOrEqual should compare correctly', () => {
      expect(centsGreaterThanOrEqual(200, 100)).toBe(true);
      expect(centsGreaterThanOrEqual(100, 100)).toBe(true);
      expect(centsGreaterThanOrEqual(50, 100)).toBe(false);
    });

    it('centsLessThan should compare correctly', () => {
      expect(centsLessThan(50, 100)).toBe(true);
      expect(centsLessThan(100, 50)).toBe(false);
      expect(centsLessThan(100, 100)).toBe(false);
    });

    it('centsLessThanOrEqual should compare correctly', () => {
      expect(centsLessThanOrEqual(50, 100)).toBe(true);
      expect(centsLessThanOrEqual(100, 100)).toBe(true);
      expect(centsLessThanOrEqual(150, 100)).toBe(false);
    });

    it('centsEquals should compare correctly', () => {
      expect(centsEquals(100, 100)).toBe(true);
      expect(centsEquals(100, 200)).toBe(false);
    });
  });

  describe('formatCents', () => {
    it('should format cents as yuan string with 2 decimals', () => {
      expect(formatCents(100)).toBe('1.00');
      expect(formatCents(1050)).toBe('10.50');
      expect(formatCents(1)).toBe('0.01');
      expect(formatCents(0)).toBe('0.00');
    });

    it('should handle negative values', () => {
      expect(formatCents(-500)).toBe('-5.00');
    });
  });

  describe('isValidMoneyAmount', () => {
    it('should return true for valid positive numbers', () => {
      expect(isValidMoneyAmount(100)).toBe(true);
      expect(isValidMoneyAmount(0.01)).toBe(true);
      expect(isValidMoneyAmount(999999)).toBe(true);
    });

    it('should return false for zero', () => {
      expect(isValidMoneyAmount(0)).toBe(false);
    });

    it('should return false for negative numbers', () => {
      expect(isValidMoneyAmount(-100)).toBe(false);
      expect(isValidMoneyAmount(-0.01)).toBe(false);
    });

    it('should return false for NaN', () => {
      expect(isValidMoneyAmount(NaN)).toBe(false);
    });

    it('should return false for Infinity', () => {
      expect(isValidMoneyAmount(Infinity)).toBe(false);
      expect(isValidMoneyAmount(-Infinity)).toBe(false);
    });

    it('should return false for non-number types', () => {
      expect(isValidMoneyAmount('100')).toBe(false);
      expect(isValidMoneyAmount(null)).toBe(false);
      expect(isValidMoneyAmount(undefined)).toBe(false);
      expect(isValidMoneyAmount({})).toBe(false);
      expect(isValidMoneyAmount([])).toBe(false);
    });

    it('should act as type guard', () => {
      const amount: unknown = 100;
      if (isValidMoneyAmount(amount)) {
        // TypeScript should recognize amount as number here
        expect(typeof amount).toBe('number');
      }
    });
  });

  describe('formatYuan', () => {
    it('should format number with ¥ prefix', () => {
      expect(formatYuan(100)).toBe('¥100.00');
      expect(formatYuan(0)).toBe('¥0.00');
      expect(formatYuan(99.9)).toBe('¥99.90');
      expect(formatYuan(1234.567)).toBe('¥1234.57');
    });

    it('should handle string input', () => {
      expect(formatYuan('100')).toBe('¥100.00');
      expect(formatYuan('99.9')).toBe('¥99.90');
    });

    it('should handle null/undefined', () => {
      expect(formatYuan(null)).toBe('¥0.00');
      expect(formatYuan(undefined)).toBe('¥0.00');
    });

    it('should handle NaN', () => {
      expect(formatYuan(NaN)).toBe('¥0.00');
      expect(formatYuan('abc')).toBe('¥0.00');
    });
  });
});
