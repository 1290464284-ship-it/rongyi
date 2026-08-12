import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { assertValidDateTimeValue, assertValidDateValue, isValidCalendarDate, parseBooleanStrict, validatePayload } from './validation';
import type { ResourceDefinition } from '../../domain/contracts';

const propertyResource: ResourceDefinition = {
  name: 'propertyTest',
  table: 'PropertyTest',
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 100 },
    { name: 'age', type: 'number', min: 0, max: 1000 },
    { name: 'ratio', type: 'decimal', min: 0, max: 10 },
    { name: 'active', type: 'boolean' },
  ],
  searchableFields: ['name'],
  defaultSort: { field: 'name', order: 'ASC' },
  capabilities: { list: true, create: true, update: true, delete: true, softDelete: true },
  roles: ['BOSS'],
};

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

  it('assertValidDateValue accepts valid YYYY-MM-DD values and rejects invalid shapes', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9999 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        (year, month, day) => {
          const text = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          if (isValidCalendarDate(year, month, day)) {
            expect(assertValidDateValue(text, 'day')).toBe(text);
          } else {
            expect(() => assertValidDateValue(text, 'day')).toThrow();
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  it('validatePayload preserves valid typed values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 1000 }),
        fc.double({ min: 0, max: 10, noNaN: true }),
        fc.boolean(),
        (age, ratio, active) => {
          const result = validatePayload(propertyResource, {
            name: 'property',
            age,
            ratio,
            active,
          });
          expect(result).toMatchObject({ name: 'property', age, ratio, active });
        },
      ),
      { numRuns: 100 },
    );
  });

  it('assertValidDateTimeValue normalizes valid datetimes and rejects invalid calendar values', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 9999 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (year, month, day, hour, minute) => {
          const text = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
          if (!isValidCalendarDate(year, month, day)) {
            expect(() => assertValidDateTimeValue(text, 'startsAt')).toThrow();
          } else {
            expect(new Date(assertValidDateTimeValue(text, 'startsAt')).getTime()).not.toBeNaN();
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('validatePayload applies defaults and rejects invalid partial payloads', () => {
    const resourceWithDefault = {
      ...propertyResource,
      fields: [
        { name: 'name', type: 'text' as const },
        { name: 'ratio', type: 'decimal' as const, default: 0.5 },
      ],
    };
    expect(validatePayload(resourceWithDefault, { name: 'x' })).toMatchObject({ ratio: 0.5 });
    expect(validatePayload(resourceWithDefault, { name: 'x' }, { partial: true })).toMatchObject({ name: 'x' });
    expect(() => validatePayload(resourceWithDefault, { ratio: 'bad' })).toThrow('ratio must be a number');
    expect(() => validatePayload(propertyResource, { name: 'x', active: 'yes' })).toThrow('active must be a boolean');
  });
});
