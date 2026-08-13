import { describe, expect, it } from 'vitest';
import { parseStringArray } from './parse';
import { createInFlightGuard } from './in-flight';
import { parseLocalDateTime } from '../appointments/date';
import { buildValidItems } from '../charges/charge-utils';
import { statusLabel } from '../prescriptions/constants';

describe('web edge helpers', () => {
  it('parses string arrays from arrays, JSON arrays, and invalid values', () => {
    expect(parseStringArray([1, 2])).toEqual(['1', '2']);
    expect(parseStringArray('["a","b"]')).toEqual(['a', 'b']);
    expect(parseStringArray('{}')).toEqual([]);
    expect(parseStringArray('bad')).toEqual([]);
    expect(parseStringArray(null)).toEqual([]);
  });

  it('deduplicates in-flight starts until finished', () => {
    const guard = createInFlightGuard();
    expect(guard.start('a')).toBe(true);
    expect(guard.start('a')).toBe(false);
    expect(guard.isRunning('a')).toBe(true);
    guard.finish('a');
    expect(guard.start('a')).toBe(true);
  });

  it('rejects rolled calendar dates and accepts valid local datetimes', () => {
    expect(parseLocalDateTime('2026-02-30T10:00')).toBeNull();
    expect(parseLocalDateTime('not-a-date')).toBeNull();
    expect(parseLocalDateTime('2026-02-28T10:00')).not.toBeNull();
  });

  it('normalizes charge item fields and falls back to unknown status labels', () => {
    expect(buildValidItems([{
      name: 'x',
      category: '',
      price: '100',
      quantity: undefined,
      costType: 'SERVICE',
    } as never])).toEqual([]);
    expect(statusLabel('UNKNOWN')).toBe('UNKNOWN');
    expect(statusLabel(null)).toBe('草稿');
  });
});
