import { InternalServerErrorException } from '@nestjs/common';
import {
  invariant,
  assertNever,
  assertDefined,
  assertIsFiniteNumber,
  assertPositiveNumber,
  assertNonNegativeNumber,
} from './assertions';

describe('assertions', () => {
  describe('invariant', () => {
    it('truthy 条件不应抛出异常', () => {
      expect(() => invariant(true, 'message')).not.toThrow();
      expect(() => invariant(1, 'message')).not.toThrow();
      expect(() => invariant('test', 'message')).not.toThrow();
      expect(() => invariant({}, 'message')).not.toThrow();
    });

    it('falsy 条件应抛出 InternalServerErrorException', () => {
      expect(() => invariant(false, '错误信息')).toThrow(InternalServerErrorException);
      expect(() => invariant(0, '错误信息')).toThrow(InternalServerErrorException);
      expect(() => invariant('', '错误信息')).toThrow(InternalServerErrorException);
      expect(() => invariant(null, '错误信息')).toThrow(InternalServerErrorException);
      expect(() => invariant(undefined, '错误信息')).toThrow(InternalServerErrorException);
    });

    it('抛出的异常应包含指定消息', () => {
      expect(() => invariant(false, '自定义错误消息')).toThrow('自定义错误消息');
    });
  });

  describe('assertNever', () => {
    it('应抛出 InternalServerErrorException', () => {
      expect(() => assertNever('unknown' as never)).toThrow(InternalServerErrorException);
    });

    it('默认错误信息应包含值', () => {
      expect(() => assertNever('test_value' as never)).toThrow('穷尽性检查失败');
      expect(() => assertNever('test_value' as never)).toThrow('test_value');
    });

    it('可自定义错误消息', () => {
      expect(() => assertNever('x' as never, '自定义穷尽性错误')).toThrow('自定义穷尽性错误');
    });

    it('应是 never 返回类型', () => {
      const fn = (val: string) => {
        if (val === 'a') return 1;
        if (val === 'b') return 2;
        return assertNever(val as never);
      };
      expect(() => fn('c')).toThrow();
    });
  });

  describe('assertDefined', () => {
    it('有值时应返回该值', () => {
      expect(assertDefined('hello')).toBe('hello');
      expect(assertDefined(123)).toBe(123);
      expect(assertDefined(false)).toBe(false);
      expect(assertDefined(0)).toBe(0);
      expect(assertDefined('')).toBe('');
      expect(assertDefined({})).toEqual({});
    });

    it('null 应抛出异常', () => {
      expect(() => assertDefined(null)).toThrow(InternalServerErrorException);
    });

    it('undefined 应抛出异常', () => {
      expect(() => assertDefined(undefined)).toThrow(InternalServerErrorException);
    });

    it('默认错误消息', () => {
      expect(() => assertDefined(null)).toThrow('值不能为 null 或 undefined');
    });

    it('可自定义错误消息', () => {
      expect(() => assertDefined(null, '用户ID不能为空')).toThrow('用户ID不能为空');
    });

    it('应正确推断类型', () => {
      const value: string | null = 'test';
      const result = assertDefined(value);
      expect(result.toUpperCase()).toBe('TEST');
    });
  });

  describe('assertIsFiniteNumber', () => {
    it('有限数字应返回原值', () => {
      expect(assertIsFiniteNumber(0)).toBe(0);
      expect(assertIsFiniteNumber(42)).toBe(42);
      expect(assertIsFiniteNumber(-100)).toBe(-100);
      expect(assertIsFiniteNumber(2.71)).toBeCloseTo(2.71);
      expect(assertIsFiniteNumber(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('Infinity 应抛出异常', () => {
      expect(() => assertIsFiniteNumber(Infinity)).toThrow(InternalServerErrorException);
      expect(() => assertIsFiniteNumber(-Infinity)).toThrow(InternalServerErrorException);
    });

    it('NaN 应抛出异常', () => {
      expect(() => assertIsFiniteNumber(NaN)).toThrow(InternalServerErrorException);
    });

    it('非数字类型应抛出异常', () => {
      expect(() => assertIsFiniteNumber('123' as unknown as number)).toThrow();
      expect(() => assertIsFiniteNumber(null)).toThrow();
      expect(() => assertIsFiniteNumber(undefined as unknown as number)).toThrow();
    });

    it('默认错误消息', () => {
      expect(() => assertIsFiniteNumber(NaN)).toThrow('期望是有限数字');
    });

    it('可自定义错误消息', () => {
      expect(() => assertIsFiniteNumber(NaN, '金额必须是有效数字')).toThrow('金额必须是有效数字');
    });
  });

  describe('assertPositiveNumber', () => {
    it('正数应返回原值', () => {
      expect(assertPositiveNumber(1)).toBe(1);
      expect(assertPositiveNumber(100)).toBe(100);
      expect(assertPositiveNumber(0.1)).toBeCloseTo(0.1);
      expect(assertPositiveNumber(Number.MAX_SAFE_INTEGER)).toBe(Number.MAX_SAFE_INTEGER);
    });

    it('0 应抛出异常', () => {
      expect(() => assertPositiveNumber(0)).toThrow(InternalServerErrorException);
    });

    it('负数应抛出异常', () => {
      expect(() => assertPositiveNumber(-1)).toThrow(InternalServerErrorException);
      expect(() => assertPositiveNumber(-0.1)).toThrow(InternalServerErrorException);
    });

    it('NaN 应抛出异常', () => {
      expect(() => assertPositiveNumber(NaN)).toThrow(InternalServerErrorException);
    });

    it('Infinity 应抛出异常', () => {
      expect(() => assertPositiveNumber(Infinity)).toThrow(InternalServerErrorException);
    });

    it('默认错误消息', () => {
      expect(() => assertPositiveNumber(0)).toThrow('期望是正数');
    });

    it('可自定义错误消息', () => {
      expect(() => assertPositiveNumber(0, '数量必须大于0')).toThrow('数量必须大于0');
    });
  });

  describe('assertNonNegativeNumber', () => {
    it('非负数应返回原值', () => {
      expect(assertNonNegativeNumber(0)).toBe(0);
      expect(assertNonNegativeNumber(1)).toBe(1);
      expect(assertNonNegativeNumber(100)).toBe(100);
      expect(assertNonNegativeNumber(0.5)).toBe(0.5);
    });

    it('负数应抛出异常', () => {
      expect(() => assertNonNegativeNumber(-1)).toThrow(InternalServerErrorException);
      expect(() => assertNonNegativeNumber(-0.1)).toThrow(InternalServerErrorException);
    });

    it('NaN 应抛出异常', () => {
      expect(() => assertNonNegativeNumber(NaN)).toThrow(InternalServerErrorException);
    });

    it('默认错误消息', () => {
      expect(() => assertNonNegativeNumber(-1)).toThrow('期望是非负数');
    });

    it('可自定义错误消息', () => {
      expect(() => assertNonNegativeNumber(-1, '库存不能为负')).toThrow('库存不能为负');
    });
  });
});
