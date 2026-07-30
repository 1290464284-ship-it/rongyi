import { describe, it, expect } from 'vitest';
import {
  formatClinicDate,
  formatClinicDateTime,
  formatClinicDateTimeShort,
  formatClinicMonthDay,
  isClinicToday,
} from '../datetime';

describe('formatClinicDate', () => {
  it('UTC 午夜（CST 08:00 同一天）返回当天', () => {
    expect(formatClinicDate('2026-07-30T00:00:00.000Z')).toBe('2026-07-30');
  });

  it('UTC 前一天 16:00（CST 当天 00:00）返回当天（跨日边界）', () => {
    expect(formatClinicDate('2026-07-29T16:00:00.000Z')).toBe('2026-07-30');
  });

  it('UTC 当天 15:59（CST 当天 23:59）返回当天', () => {
    expect(formatClinicDate('2026-07-30T15:59:00.000Z')).toBe('2026-07-30');
  });

  it('UTC 当天 16:00（CST 次日 00:00）返回次日', () => {
    expect(formatClinicDate('2026-07-30T16:00:00.000Z')).toBe('2026-07-31');
  });

  it('接受 Date 对象', () => {
    expect(formatClinicDate(new Date('2026-07-30T10:00:00.000Z'))).toBe('2026-07-30');
  });

  it('接受时间戳', () => {
    const t = new Date('2026-07-30T10:00:00.000Z').getTime();
    expect(formatClinicDate(t)).toBe('2026-07-30');
  });

  it('无效输入抛错', () => {
    expect(() => formatClinicDate('not-a-date')).toThrow();
  });
});

describe('formatClinicDateTime', () => {
  it('返回完整本地时间 YYYY-MM-DD HH:mm:ss', () => {
    expect(formatClinicDateTime('2026-07-30T10:30:45.000Z')).toBe('2026-07-30 18:30:45');
  });

  it('跨日：UTC 16:00 = CST 次日 00:00', () => {
    expect(formatClinicDateTime('2026-07-30T16:00:00.000Z')).toBe('2026-07-31 00:00:00');
  });
});

describe('formatClinicDateTimeShort', () => {
  it('返回 MM-DD HH:mm', () => {
    expect(formatClinicDateTimeShort('2026-07-30T10:30:00.000Z')).toBe('07-30 18:30');
  });
});

describe('formatClinicMonthDay', () => {
  it('返回 MM-DD', () => {
    expect(formatClinicMonthDay('2026-07-30T10:30:00.000Z')).toBe('07-30');
  });
});

describe('isClinicToday', () => {
  it('当前 UTC 时间落在 CST 今天范围内返回 true', () => {
    // 用 CST 日期（而非 UTC 日期）构造测试输入，避免 UTC/CST 跨日时偏差
    const now = new Date();
    const cstNow = new Date(now.getTime() + 8 * 60 * 60 * 1000); // CST = UTC+8
    const cstTodayNoonUtc = new Date(
      Date.UTC(cstNow.getUTCFullYear(), cstNow.getUTCMonth(), cstNow.getUTCDate(), 4, 0, 0),
    );
    expect(isClinicToday(cstTodayNoonUtc)).toBe(true);
  });

  it('明显是昨天的日期返回 false', () => {
    expect(isClinicToday('2020-01-01T00:00:00.000Z')).toBe(false);
  });
});
