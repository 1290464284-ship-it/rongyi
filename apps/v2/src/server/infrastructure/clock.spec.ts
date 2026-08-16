import { describe, expect, it } from 'vitest';
import { clinicDayEndUtc, clinicDayStartUtc, clinicTzOffsetSuffix, tzOffsetSuffix } from './clock';

describe('clinic day boundaries', () => {
  it('converts a clinic date to its UTC day start (Asia/Shanghai +8)', () => {
    expect(clinicDayStartUtc('2026-08-13')).toBe('2026-08-12T16:00:00.000Z');
  });

  it('converts a clinic date to its UTC day end (23:59:59.999)', () => {
    expect(clinicDayEndUtc('2026-08-13')).toBe('2026-08-13T15:59:59.999Z');
  });

  it('returns null for dates that would roll over or fail the YYYY-MM-DD shape', () => {
    expect(clinicDayStartUtc('2026-02-30')).toBeNull();
    expect(clinicDayStartUtc('2026-13-01')).toBeNull();
    expect(clinicDayStartUtc('not-a-date')).toBeNull();
    expect(clinicDayEndUtc('2026-02-30')).toBeNull();
  });
});

describe('clinic timezone offset suffix', () => {
  it('formats the clinic offset from the shared constant', () => {
    expect(clinicTzOffsetSuffix()).toBe('+08:00');
  });

  it('formats positive, negative and zero offsets', () => {
    expect(tzOffsetSuffix(8)).toBe('+08:00');
    expect(tzOffsetSuffix(-5)).toBe('-05:00');
    expect(tzOffsetSuffix(0)).toBe('+00:00');
    expect(tzOffsetSuffix(10)).toBe('+10:00');
  });
});
