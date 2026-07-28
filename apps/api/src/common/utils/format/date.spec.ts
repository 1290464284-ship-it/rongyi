
import fc from 'fast-check';
import { BusinessValidationException } from '@common/errors';
import {
  nowISO,
  toISOString,
  getLocalStartOfDay,
  getLocalEndOfDay,
  getLocalDateRange,
  formatDate,
  formatDateTime,
  parseDate,
  isSameDay,
  daysAgo,
  startOfMonth,
  endOfMonth,
  validateDates,
  parseDateRange,
  getLocalMonthStr,
  addDays,
  isDateInPast,
  isDateInFuture,
  isDateValid,
  endOfDay,
  startOfDay,
  getLocalDateStr,
} from './date';

describe('date utils', () => {
  describe('formatDate', () => {
    it('应正确格式化日期对象', () => {
      const date = new Date(2024, 0, 15);
      expect(formatDate(date)).toBe('2024-01-15');
    });

    it('应正确格式化日期字符串', () => {
      expect(formatDate('2024-01-15')).toBe('2024-01-15');
    });

    it('应补零月份和日期', () => {
      const date = new Date(2024, 0, 5);
      expect(formatDate(date)).toBe('2024-01-05');
    });

    it('无效日期应抛出异常', () => {
      expect(() => formatDate('invalid-date')).toThrow(BusinessValidationException);
      expect(() => formatDate('')).toThrow(BusinessValidationException);
    });
  });

  describe('formatDateTime', () => {
    it('应正确格式化日期时间', () => {
      const date = new Date(2024, 0, 15, 14, 30, 45);
      expect(formatDateTime(date)).toBe('2024-01-15 14:30:45');
    });

    it('应补零时分秒', () => {
      const date = new Date(2024, 0, 5, 9, 5, 3);
      expect(formatDateTime(date)).toBe('2024-01-05 09:05:03');
    });
  });

  describe('parseDate', () => {
    it('应正确解析有效日期字符串', () => {
      const date = parseDate('2024-01-15');
      expect(date.getFullYear()).toBe(2024);
      expect(date.getMonth()).toBe(0);
      expect(date.getDate()).toBe(15);
    });

    it('非字符串输入应抛出异常', () => {
      expect(() => parseDate(123 as unknown as string)).toThrow(BusinessValidationException);
      expect(() => parseDate(null)).toThrow(BusinessValidationException);
      expect(() => parseDate(undefined as unknown as string)).toThrow(BusinessValidationException);
    });

    it('空字符串应抛出异常', () => {
      expect(() => parseDate('')).toThrow(BusinessValidationException);
      expect(() => parseDate('   ')).toThrow(BusinessValidationException);
    });

    it('无效日期格式应抛出异常', () => {
      expect(() => parseDate('not-a-date')).toThrow(BusinessValidationException);
      expect(() => parseDate('2024-99-99')).toThrow(BusinessValidationException);
    });
  });

  describe('isSameDay', () => {
    it('同一天应返回 true', () => {
      const date1 = new Date(2024, 0, 15, 10, 30);
      const date2 = new Date(2024, 0, 15, 23, 59);
      expect(isSameDay(date1, date2)).toBe(true);
    });

    it('不同天应返回 false', () => {
      const date1 = new Date(2024, 0, 15);
      const date2 = new Date(2024, 0, 16);
      expect(isSameDay(date1, date2)).toBe(false);
    });

    it('不同月份应返回 false', () => {
      const date1 = new Date(2024, 0, 31);
      const date2 = new Date(2024, 1, 1);
      expect(isSameDay(date1, date2)).toBe(false);
    });

    it('不同年份应返回 false', () => {
      const date1 = new Date(2023, 11, 31);
      const date2 = new Date(2024, 0, 1);
      expect(isSameDay(date1, date2)).toBe(false);
    });

    it('字符串日期也应正确比较', () => {
      expect(isSameDay('2024-01-15', '2024-01-15')).toBe(true);
      expect(isSameDay('2024-01-15', '2024-01-16')).toBe(false);
    });
  });

  describe('getLocalStartOfDay', () => {
    it('应返回当天本地开始时间的 ISO 字符串', () => {
      const date = new Date(2024, 0, 15, 14, 30);
      const result = getLocalStartOfDay(date);
      const parsed = new Date(result);
      expect(parsed.getUTCFullYear()).toBeDefined();
      expect(result).toMatch(/\.\d{3}Z$/);
    });

    it('字符串日期输入也应正确处理', () => {
      const result = getLocalStartOfDay('2024-01-15');
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(result).toMatch(/\.\d{3}Z$/);
    });

    it('返回的时间应该是本地日期的开始', () => {
      const date = new Date(2024, 0, 15);
      const result = getLocalStartOfDay(date);
      const localDate = new Date(result);
      expect(localDate.getFullYear()).toBe(2024);
      expect(localDate.getMonth()).toBe(0);
      expect(localDate.getDate()).toBe(15);
      expect(localDate.getHours()).toBe(0);
      expect(localDate.getMinutes()).toBe(0);
      expect(localDate.getSeconds()).toBe(0);
    });
  });

  describe('getLocalEndOfDay', () => {
    it('应返回当天本地结束时间的 ISO 字符串', () => {
      const date = new Date(2024, 0, 15);
      const result = getLocalEndOfDay(date);
      const localDate = new Date(result);
      expect(localDate.getFullYear()).toBe(2024);
      expect(localDate.getMonth()).toBe(0);
      expect(localDate.getDate()).toBe(15);
      expect(localDate.getHours()).toBe(23);
      expect(localDate.getMinutes()).toBe(59);
      expect(localDate.getSeconds()).toBe(59);
    });
  });

  describe('getLocalDateRange', () => {
    it('应返回开始和结束时间范围', () => {
      const result = getLocalDateRange('2024-01-15', '2024-01-20');
      expect(result.start).toBeTruthy();
      expect(result.end).toBeTruthy();
      const startDate = new Date(result.start);
      const endDate = new Date(result.end);
      expect(startDate.getHours()).toBe(0);
      expect(endDate.getHours()).toBe(23);
    });
  });

  describe('addDays', () => {
    it('应正确增加天数', () => {
      expect(addDays('2024-01-15', 5)).toBe('2024-01-20');
    });

    it('应正确减少天数（负数）', () => {
      expect(addDays('2024-01-15', -5)).toBe('2024-01-10');
    });

    it('应正确跨月', () => {
      expect(addDays('2024-01-31', 1)).toBe('2024-02-01');
    });

    it('应正确跨年', () => {
      expect(addDays('2023-12-31', 1)).toBe('2024-01-01');
    });

    it('零天应返回同一天', () => {
      expect(addDays('2024-01-15', 0)).toBe('2024-01-15');
    });
  });

  describe('isDateValid', () => {
    it('有效日期应返回 true', () => {
      expect(isDateValid('2024-01-15')).toBe(true);
      expect(isDateValid('2024-12-31')).toBe(true);
    });

    it('无效日期应返回 false', () => {
      expect(isDateValid('invalid')).toBe(false);
      expect(isDateValid('')).toBe(false);
    });
  });

  describe('validateDates', () => {
    it('有效日期不应抛出异常', () => {
      expect(() => validateDates('2024-01-15', '2024-01-20')).not.toThrow();
    });

    it('无效的 startDate 应抛出异常', () => {
      expect(() => validateDates('invalid', '2024-01-20')).toThrow(BusinessValidationException);
    });

    it('无效的 endDate 应抛出异常', () => {
      expect(() => validateDates('2024-01-15', 'invalid')).toThrow(BusinessValidationException);
    });

    it('空参数不应抛出异常', () => {
      expect(() => validateDates()).not.toThrow();
      expect(() => validateDates()).not.toThrow();
    });

    it('格式正确但不存在的日期应抛出异常', () => {
      expect(() => validateDates('2024-02-30')).toThrow(BusinessValidationException);
      expect(() => validateDates('2024-13-01')).toThrow(BusinessValidationException);
    });
  });

  describe('parseDateRange', () => {
    it('应解析有效的日期范围', () => {
      const result = parseDateRange('2024-01-15', '2024-01-20');
      expect(result.start).not.toBeNull();
      expect(result.end).not.toBeNull();
      const startDate = new Date(result.start);
      const endDate = new Date(result.end);
      expect(startDate.getHours()).toBe(0);
      expect(endDate.getHours()).toBe(23);
    });

    it('只有 startDate 时 end 应为 null', () => {
      const result = parseDateRange('2024-01-15');
      expect(result.start).not.toBeNull();
      expect(result.end).toBeNull();
    });

    it('只有 endDate 时 start 应为 null', () => {
      const result = parseDateRange(undefined, '2024-01-20');
      expect(result.start).toBeNull();
      expect(result.end).not.toBeNull();
    });

    it('都为空时都返回 null', () => {
      const result = parseDateRange();
      expect(result.start).toBeNull();
      expect(result.end).toBeNull();
    });
  });

  describe('toISOString', () => {
    it('应正确转换为 ISO 字符串', () => {
      const date = new Date('2024-01-15T10:30:00Z');
      expect(toISOString(date)).toBe('2024-01-15T10:30:00.000Z');
    });

    it('字符串输入也应正确转换', () => {
      expect(toISOString('2024-01-15')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('无效日期应抛出异常', () => {
      expect(() => toISOString('invalid')).toThrow(BusinessValidationException);
    });
  });

  describe('getLocalMonthStr', () => {
    it('应返回 YYYY-MM 格式的月份字符串', () => {
      const date = new Date(2024, 0, 15);
      expect(getLocalMonthStr(date)).toBe('2024-01');
    });

    it('12 月应正确处理', () => {
      const date = new Date(2024, 11, 31);
      expect(getLocalMonthStr(date)).toBe('2024-12');
    });
  });

  describe('getLocalDateStr', () => {
    it('应返回 YYYY-MM-DD 格式的日期字符串', () => {
      const date = new Date(2024, 0, 15);
      expect(getLocalDateStr(date)).toBe('2024-01-15');
    });
  });

  describe('startOfDay / endOfDay', () => {
    it('startOfDay 应是 getLocalStartOfDay 的别名', () => {
      expect(startOfDay('2024-01-15')).toBe(getLocalStartOfDay('2024-01-15'));
    });

    it('endOfDay 应是 getLocalEndOfDay 的别名', () => {
      expect(endOfDay('2024-01-15')).toBe(getLocalEndOfDay('2024-01-15'));
    });
  });

  describe('startOfMonth / endOfMonth', () => {
    it('startOfMonth 应返回当月第一天', () => {
      const date = new Date(2024, 0, 15);
      const result = startOfMonth(date);
      const localDate = new Date(result);
      expect(localDate.getDate()).toBe(1);
      expect(localDate.getHours()).toBe(0);
    });

    it('endOfMonth 应返回当月最后一天', () => {
      const date = new Date(2024, 0, 15);
      const result = endOfMonth(date);
      const localDate = new Date(result);
      expect(localDate.getDate()).toBe(31);
      expect(localDate.getHours()).toBe(23);
    });

    it('2 月闰年应正确处理', () => {
      const date = new Date(2024, 1, 15);
      const result = endOfMonth(date);
      const localDate = new Date(result);
      expect(localDate.getDate()).toBe(29);
    });
  });

  describe('daysAgo', () => {
    it('应返回 N 天前的日期', () => {
      const result = daysAgo(7);
      const expected = new Date();
      expected.setDate(expected.getDate() - 7);
      const resultDate = new Date(result);
      expect(resultDate.getDate()).toBe(expected.getDate());
      expect(resultDate.getMonth()).toBe(expected.getMonth());
      expect(resultDate.getFullYear()).toBe(expected.getFullYear());
    });
  });

  describe('nowISO', () => {
    it('应返回当前时间的 ISO 字符串', () => {
      const before = new Date().toISOString();
      const result = nowISO();
      const after = new Date().toISOString();
      expect(result >= before).toBe(true);
      expect(result <= after).toBe(true);
    });
  });

  describe('isDateInPast / isDateInFuture', () => {
    it('过去的日期 isDateInPast 应返回 true', () => {
      expect(isDateInPast('2020-01-01')).toBe(true);
    });

    it('未来的日期 isDateInFuture 应返回 true', () => {
      expect(isDateInFuture('2099-01-01')).toBe(true);
    });
  });

  describe('属性测试 (fast-check)', () => {
    const validDateStr = fc
      .tuple(
        fc.integer({ min: 1900, max: 2100 }),
        fc.integer({ min: 0, max: 11 }),
        fc.integer({ min: 1, max: 28 })
      )
      .map(([year, month, day]) => {
        const d = new Date(year, month, day);
        return formatDate(d);
      });

    const dayOffset = fc.integer({ min: -3650, max: 3650 });

    it('formatDate(parseDate(str)) === str 对于合法日期', () => {
      const property = fc.property(validDateStr, (dateStr) => {
        return formatDate(parseDate(dateStr)) === dateStr;
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('isSameDay(d, d) === true（自反性）', () => {
      const property = fc.property(validDateStr, (dateStr) => {
        return isSameDay(dateStr, dateStr) === true;
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('isSameDay 对称性：isSameDay(a, b) === isSameDay(b, a)', () => {
      const property = fc.property(validDateStr, validDateStr, (a, b) => {
        return isSameDay(a, b) === isSameDay(b, a);
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('addDays(d, 0) === d（加0天不变）', () => {
      const property = fc.property(validDateStr, (dateStr) => {
        return addDays(dateStr, 0) === dateStr;
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('addDays(addDays(d, n), -n) === d（加n天再减n天不变）', () => {
      const property = fc.property(validDateStr, dayOffset, (dateStr, n) => {
        return addDays(addDays(dateStr, n), -n) === dateStr;
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('addDays 可加性：addDays(addDays(d, n), m) === addDays(d, n + m)', () => {
      const property = fc.property(validDateStr, dayOffset, dayOffset, (dateStr, n, m) => {
        return addDays(addDays(dateStr, n), m) === addDays(dateStr, n + m);
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('startOfMonth 返回的日期是当月1号', () => {
      const property = fc.property(validDateStr, (dateStr) => {
        const result = startOfMonth(parseDate(dateStr));
        const parsed = new Date(result);
        return parsed.getDate() === 1;
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('endOfMonth 返回的日期是当月最后一天（下月1号减1天）', () => {
      const property = fc.property(validDateStr, (dateStr) => {
        const result = endOfMonth(parseDate(dateStr));
        const parsed = new Date(result);
        const nextDay = new Date(parsed);
        nextDay.setDate(parsed.getDate() + 1);
        return nextDay.getDate() === 1;
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('formatDate 输出格式正确（YYYY-MM-DD）', () => {
      const property = fc.property(validDateStr, (dateStr) => {
        const result = formatDate(parseDate(dateStr));
        return /^\d{4}-\d{2}-\d{2}$/.test(result);
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('isDateValid 对有效日期返回 true', () => {
      const property = fc.property(validDateStr, (dateStr) => {
        return isDateValid(dateStr) === true;
      });
      expect(fc.assert(property)).toBe(undefined);
    });

    it('getLocalMonthStr 输出格式正确（YYYY-MM）', () => {
      const property = fc.property(validDateStr, (dateStr) => {
        const result = getLocalMonthStr(parseDate(dateStr));
        return /^\d{4}-\d{2}$/.test(result);
      });
      expect(fc.assert(property)).toBe(undefined);
    });
  });
});
