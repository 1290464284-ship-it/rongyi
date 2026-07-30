import { describe, it, expect } from 'vitest';
import {
  CLINIC_TIMEZONE,
  CLINIC_TZ_OFFSET_HOURS,
  CLINIC_TZ_SQL_MODIFIER,
  getLocalDateInClinicTz,
  getLocalDateTimeInClinicTz,
} from '../timezone';

describe('CLINIC_TIMEZONE 常量', () => {
  it('固定为 Asia/Shanghai', () => {
    expect(CLINIC_TIMEZONE).toBe('Asia/Shanghai');
  });

  it('偏移小时为 8', () => {
    expect(CLINIC_TZ_OFFSET_HOURS).toBe(8);
  });

  it('SQL modifier 为 "+8 hours"', () => {
    expect(CLINIC_TZ_SQL_MODIFIER).toBe('+8 hours');
  });
});

describe('getLocalDateInClinicTz', () => {
  it('UTC 午夜（CST 08:00 同一天）返回当天', () => {
    // 2026-07-30T00:00:00Z = CST 2026-07-30 08:00
    expect(getLocalDateInClinicTz('2026-07-30T00:00:00.000Z')).toBe('2026-07-30');
  });

  it('UTC 前一天 16:00（CST 当天 00:00）返回当天', () => {
    // 2026-07-29T16:00:00Z = CST 2026-07-30 00:00
    expect(getLocalDateInClinicTz('2026-07-29T16:00:00.000Z')).toBe('2026-07-30');
  });

  it('UTC 当天 15:59（CST 当天 23:59）返回当天', () => {
    // 2026-07-30T15:59:00Z = CST 2026-07-30 23:59
    expect(getLocalDateInClinicTz('2026-07-30T15:59:00.000Z')).toBe('2026-07-30');
  });

  it('UTC 当天 16:00（CST 次日 00:00）返回次日（跨日边界）', () => {
    // 2026-07-30T16:00:00Z = CST 2026-07-31 00:00
    expect(getLocalDateInClinicTz('2026-07-30T16:00:00.000Z')).toBe('2026-07-31');
  });

  it('接受 Date 对象', () => {
    const d = new Date('2026-07-30T10:00:00.000Z'); // CST 18:00
    expect(getLocalDateInClinicTz(d)).toBe('2026-07-30');
  });

  it('接受时间戳', () => {
    const t = new Date('2026-07-30T10:00:00.000Z').getTime();
    expect(getLocalDateInClinicTz(t)).toBe('2026-07-30');
  });

  it('无效输入抛错', () => {
    expect(() => getLocalDateInClinicTz('not-a-date')).toThrow(/无效日期输入/);
  });

  it('跨年：UTC 12-31 16:00 = CST 次年 01-01 00:00', () => {
    expect(getLocalDateInClinicTz('2026-12-31T16:00:00.000Z')).toBe('2027-01-01');
  });

  it('跨年：CST 12-31 23:59 = UTC 12-31 15:59', () => {
    expect(getLocalDateInClinicTz('2026-12-31T15:59:00.000Z')).toBe('2026-12-31');
  });
});

describe('getLocalDateTimeInClinicTz', () => {
  it('UTC 时间加 8 小时返回完整本地时间', () => {
    expect(getLocalDateTimeInClinicTz('2026-07-30T10:30:45.000Z')).toBe('2026-07-30 18:30:45');
  });

  it('跨日：UTC 16:00 = CST 次日 00:00', () => {
    expect(getLocalDateTimeInClinicTz('2026-07-30T16:00:00.000Z')).toBe('2026-07-31 00:00:00');
  });

  it('无效输入抛错', () => {
    expect(() => getLocalDateTimeInClinicTz('xyz')).toThrow(/无效日期输入/);
  });
});
