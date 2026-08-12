import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { isValidCalendarDate, parseBooleanStrict } from './validation';

describe('validation property-based', () => {
  it('parseBooleanStrict accepts only canonical truthy/falsy values', () => {
    const accepted = new Set(['true', '1', 'false', '0', true, false, 1, 0]);
    fc.assert(
      fc.property(
        fc.anything(),
        (value) => {
          if (accepted.has(value as never)) {
            expect(typeof parseBooleanStrict(value)).toBe('boolean');
          } else {
            expect(() => parseBooleanStrict(value)).toThrow();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('isValidCalendarDate matches the JavaScript UTC calendar result', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 2100 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        (year, month, day) => {
          const probe = new Date(Date.UTC(year, month - 1, day));
          const expected = probe.getUTCFullYear() === year && probe.getUTCMonth() === month - 1 && probe.getUTCDate() === day;
          expect(isValidCalendarDate(year, month, day)).toBe(expected);
        },
      ),
      { numRuns: 300 },
    );
  });
});
