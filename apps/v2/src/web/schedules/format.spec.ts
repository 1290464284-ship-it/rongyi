// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { formatWeekRange, formatWorkDays, mondayOf, parseWorkDays } from './format';

describe('schedules/format', () => {
  it('parses work days from JSON, arrays and invalid input', () => {
    expect(parseWorkDays({ workDaysJson: '[3,1,7]', workDays: [] })).toEqual([1, 3, 7]);
    expect(parseWorkDays({ workDaysJson: null, workDays: [6, 5] })).toEqual([5, 6]);
    expect(parseWorkDays({ workDaysJson: 'not-json', workDays: undefined })).toEqual([1, 2, 3, 4, 5]);
    expect(parseWorkDays({ workDaysJson: '[9,0,2]' })).toEqual([2]);
    expect(parseWorkDays({ workDaysJson: null, workDays: undefined })).toEqual([1, 2, 3, 4, 5]);
  });

  it('formats work days as readable ranges', () => {
    expect(formatWorkDays([1, 2, 3, 4, 5])).toBe('周一~周五');
    expect(formatWorkDays([6, 7])).toBe('周六~周日');
    expect(formatWorkDays([1, 3, 5])).toBe('周一、周三、周五');
    expect(formatWorkDays([])).toBe('未设置');
  });

  it('formats week ranges and normalizes any picked date to Monday', () => {
    expect(formatWeekRange('2026-08-03')).toBe('2026-08-03 ~ 2026-08-09');
    expect(formatWeekRange('bad')).toBe('bad');
    expect(mondayOf(new Date(2026, 7, 10))).toBe('2026-08-10');
    expect(mondayOf(new Date(2026, 7, 16))).toBe('2026-08-10');
    expect(mondayOf(new Date(2026, 7, 9))).toBe('2026-08-03');
  });
});
