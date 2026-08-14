import { describe, expect, it } from 'vitest';
import type { ResourceDefinition } from '../../domain/contracts';
import {
  assertValidDateValue,
  assertValidDateTimeValue,
  parseBooleanStrict,
  validatePayload,
} from './validation';

function resource(fields: ResourceDefinition['fields']): ResourceDefinition {
  return {
    name: 'validationTest',
    table: 'ValidationTest',
    fields,
    searchableFields: [],
    defaultSort: { field: 'id', order: 'ASC' },
    capabilities: { list: true, create: true, update: true, delete: true, softDelete: true },
    roles: ['BOSS'],
  };
}

describe('validatePayload required/default handling', () => {
  it('throws for missing required fields and applies defaults only for undefined', () => {
    const definition = resource([
      { name: 'name', type: 'text', required: true },
      { name: 'ratio', type: 'decimal', default: 0.5 },
    ]);
    expect(() => validatePayload(definition, {})).toThrow('name is required');
    expect(validatePayload(definition, { name: 'x' })).toEqual({ name: 'x', ratio: 0.5 });
    expect(validatePayload(definition, { name: 'x' }, { partial: true })).toEqual({ name: 'x' });
    expect(validatePayload(definition, { name: 'x', ratio: null })).toEqual({ name: 'x' });
  });

  it('throws for null required fields and skips null optional fields without defaults', () => {
    const definition = resource([
      { name: 'name', type: 'text', required: true },
      { name: 'note', type: 'text' },
    ]);
    expect(() => validatePayload(definition, { name: null })).toThrow('name is required');
    expect(validatePayload(definition, { name: 'x', note: null })).toEqual({ name: 'x' });
    expect(validatePayload(definition, { name: 'x', note: null }, { partial: true })).toEqual({ name: 'x', note: null });
  });
});

describe('validateField text/relation/longText', () => {
  it('validates text values, required non-empty, and max length', () => {
    const definition = resource([{ name: 'title', type: 'text', required: true, maxLength: 5 }]);
    expect(validatePayload(definition, { title: 'ok' })).toEqual({ title: 'ok' });
    expect(validatePayload(definition, { title: '12345' })).toEqual({ title: '12345' });
    expect(() => validatePayload(definition, { title: '' })).toThrow('title is required');
    expect(() => validatePayload(definition, { title: '   ' })).toThrow('title is required');
    expect(() => validatePayload(definition, { title: 'toolong' })).toThrow('title exceeds max length 5');
    expect(() => validatePayload(definition, { title: 7 })).toThrow('title must be a string');
  });

  it('validates relation values like text', () => {
    const definition = resource([{ name: 'patientId', type: 'relation' }]);
    expect(validatePayload(definition, { patientId: 'patient-1' })).toEqual({ patientId: 'patient-1' });
    expect(() => validatePayload(definition, { patientId: {} })).toThrow('patientId must be a string');
  });

  it('enforces the implicit longText limit when no maxLength is configured', () => {
    const definition = resource([{ name: 'body', type: 'longText' }]);
    expect(validatePayload(definition, { body: 'short' })).toEqual({ body: 'short' });
    const atLimit = 'x'.repeat(500_000);
    expect(validatePayload(definition, { body: atLimit })).toEqual({ body: atLimit });
    const huge = 'x'.repeat(500_001);
    expect(() => validatePayload(definition, { body: huge })).toThrow('body exceeds max length 500000');
  });

  it('does not apply the implicit longText limit to plain text fields', () => {
    const definition = resource([{ name: 'body', type: 'text' }]);
    const huge = 'x'.repeat(500_001);
    expect(validatePayload(definition, { body: huge })).toEqual({ body: huge });
  });
});

describe('date and datetime validation', () => {
  it('accepts valid calendar dates and rejects malformed or impossible dates', () => {
    expect(assertValidDateValue('2024-02-29', 'day')).toBe('2024-02-29');
    expect(() => assertValidDateValue('2024-02-30', 'day')).toThrow('day must be a valid YYYY-MM-DD date');
    expect(() => assertValidDateValue('2024-13-01', 'day')).toThrow('day must be a valid YYYY-MM-DD date');
    expect(() => assertValidDateValue('2024-01-00', 'day')).toThrow('day must be a valid YYYY-MM-DD date');
    expect(() => assertValidDateValue('x2024-01-01', 'day')).toThrow('day must be a valid YYYY-MM-DD date');
    expect(() => assertValidDateValue('2024-01-01x', 'day')).toThrow('day must be a valid YYYY-MM-DD date');
    expect(() => assertValidDateValue('2024-2-3', 'day')).toThrow('day must be a valid YYYY-MM-DD date');
    expect(() => assertValidDateValue(20240229, 'day')).toThrow('day must be a valid YYYY-MM-DD date');
  });

  it('normalizes valid datetimes and rejects malformed, impossible, or oversized fractional values', () => {
    expect(assertValidDateTimeValue('2024-02-29T10:00:00Z', 'startsAt')).toBe('2024-02-29T10:00:00.000Z');
    expect(assertValidDateTimeValue('2024-02-29T10:00:00+08:00', 'startsAt')).toBe('2024-02-29T02:00:00.000Z');
    expect(() => assertValidDateTimeValue('2024-02-30T10:00:00Z', 'startsAt')).toThrow('startsAt must be a valid date-time');
    expect(() => assertValidDateTimeValue('2024-01-01T25:00:00Z', 'startsAt')).toThrow('startsAt must be a valid date-time');
    expect(() => assertValidDateTimeValue('2024-01-01T10:00:00.1234Z', 'startsAt')).toThrow('startsAt must be a valid date-time');
    expect(() => assertValidDateTimeValue('2024-01-01', 'startsAt')).toThrow('startsAt must be a valid date-time');
    expect(() => assertValidDateTimeValue('x2024-01-01T10:00:00Z', 'startsAt')).toThrow('startsAt must be a valid date-time');
    expect(() => assertValidDateTimeValue('2024-01-01T10:00:00Zx', 'startsAt')).toThrow('startsAt must be a valid date-time');
    expect(() => assertValidDateTimeValue('2024-01-01T10:00:00', 'startsAt')).toThrow('startsAt must be a valid date-time');
  });

  it('validates date and datetime fields through payload validation', () => {
    const definition = resource([
      { name: 'day', type: 'date' },
      { name: 'startsAt', type: 'datetime' },
    ]);
    expect(validatePayload(definition, {
      day: '2024-01-01',
      startsAt: '2024-01-01T10:00:00Z',
    })).toEqual({ day: '2024-01-01', startsAt: '2024-01-01T10:00:00.000Z' });
  });
});

describe('decimal validation', () => {
  it('parses numeric strings and enforces min/max bounds', () => {
    const definition = resource([{ name: 'ratio', type: 'decimal', min: 0, max: 10 }]);
    expect(validatePayload(definition, { ratio: '1.5' })).toEqual({ ratio: 1.5 });
    expect(validatePayload(definition, { ratio: 3 })).toEqual({ ratio: 3 });
    expect(validatePayload(definition, { ratio: 0 })).toEqual({ ratio: 0 });
    expect(validatePayload(definition, { ratio: 10 })).toEqual({ ratio: 10 });
    expect(() => validatePayload(definition, { ratio: '' })).toThrow('ratio must be a number');
    expect(() => validatePayload(definition, { ratio: '  ' })).toThrow('ratio must be a number');
    expect(() => validatePayload(definition, { ratio: 'abc' })).toThrow('ratio must be a number');
    expect(() => validatePayload(definition, { ratio: {} })).toThrow('ratio must be a number');
    expect(() => validatePayload(definition, { ratio: -1 })).toThrow('ratio must be >= 0');
    expect(() => validatePayload(definition, { ratio: 11 })).toThrow('ratio must be <= 10');
  });
});

describe('number and money validation', () => {
  it('requires safe integers and enforces min/max bounds', () => {
    const definition = resource([{ name: 'age', type: 'number', min: 0, max: 100 }]);
    expect(validatePayload(definition, { age: '42' })).toEqual({ age: 42 });
    expect(validatePayload(definition, { age: 0 })).toEqual({ age: 0 });
    expect(validatePayload(definition, { age: 100 })).toEqual({ age: 100 });
    const unlimited = resource([{ name: 'age', type: 'number' }]);
    expect(validatePayload(unlimited, { age: Number.MAX_SAFE_INTEGER })).toEqual({ age: Number.MAX_SAFE_INTEGER });
    expect(() => validatePayload(definition, { age: 'abc' })).toThrow('age must be a number');
    expect(() => validatePayload(definition, { age: '' })).toThrow('age must be a number');
    expect(() => validatePayload(definition, { age: 42.5 })).toThrow('age must be an integer amount in cents');
    expect(() => validatePayload(definition, { age: {} })).toThrow('age must be a number');
    expect(() => validatePayload(definition, { age: Number.MAX_SAFE_INTEGER + 1 })).toThrow('age must be within safe integer range');
    expect(() => validatePayload(definition, { age: -1 })).toThrow('age must be >= 0');
    expect(() => validatePayload(definition, { age: 101 })).toThrow('age must be <= 100');
  });

  it('validates money against negative and maximum amount bounds', () => {
    const definition = resource([{ name: 'amount', type: 'money' }]);
    expect(validatePayload(definition, { amount: 100 })).toEqual({ amount: 100 });
    expect(validatePayload(definition, { amount: 0 })).toEqual({ amount: 0 });
    expect(validatePayload(definition, { amount: 1_000_000_000_000 })).toEqual({ amount: 1_000_000_000_000 });
    expect(() => validatePayload(definition, { amount: 'abc' })).toThrow('amount must be a number');
    expect(() => validatePayload(definition, { amount: '12.5' })).toThrow('amount must be an integer amount in cents');
    expect(() => validatePayload(definition, { amount: -1 })).toThrow('amount must be non-negative');
    expect(() => validatePayload(definition, { amount: 1_000_000_000_001 })).toThrow(
      'amount exceeds maximum amount of 1000000000000 cents',
    );
  });
});

describe('boolean validation', () => {
  it('accepts only the canonical truthy and falsy representations', () => {
    expect(parseBooleanStrict('1')).toBe(true);
    expect(parseBooleanStrict('true')).toBe(true);
    expect(parseBooleanStrict('0')).toBe(false);
    expect(parseBooleanStrict('false')).toBe(false);
    expect(parseBooleanStrict(1)).toBe(true);
    expect(parseBooleanStrict(0)).toBe(false);
    expect(parseBooleanStrict(true)).toBe(true);
    expect(parseBooleanStrict(false)).toBe(false);
    for (const bad of ['yes', 'on', 2, [], {}, null]) {
      expect(() => parseBooleanStrict(bad as never)).toThrow('boolean must be a boolean');
    }
  });

  it('rejects non-boolean payload values', () => {
    const definition = resource([{ name: 'active', type: 'boolean' }]);
    expect(validatePayload(definition, { active: '1' })).toEqual({ active: true });
    expect(() => validatePayload(definition, { active: [] })).toThrow('active must be a boolean');
  });
});

describe('enum and json validation', () => {
  it('accepts only declared enum values', () => {
    const definition = resource([{ name: 'status', type: 'enum', enumValues: ['DRAFT', 'DONE'] }]);
    expect(validatePayload(definition, { status: 'DONE' })).toEqual({ status: 'DONE' });
    expect(() => validatePayload(definition, { status: 'NOPE' })).toThrow('status must be one of DRAFT, DONE');
    const withoutValues = resource([{ name: 'status', type: 'enum' }]);
    expect(() => validatePayload(withoutValues, { status: 'DONE' })).toThrow('status must be one of undefined');
  });

  it('accepts JSON strings, objects, and arrays and rejects invalid or oversized payloads', () => {
    const definition = resource([{ name: 'data', type: 'json' }]);
    expect(validatePayload(definition, { data: '{"a":1}' })).toEqual({ data: '{"a":1}' });
    expect(validatePayload(definition, { data: { a: 1 } })).toEqual({ data: { a: 1 } });
    expect(validatePayload(definition, { data: [1, 2] })).toEqual({ data: [1, 2] });
    expect(() => validatePayload(definition, { data: '{bad' })).toThrow('data must be valid JSON');
    expect(() => validatePayload(definition, { data: 42 })).toThrow('data must be JSON-compatible');
    const hugeString = `["${'x'.repeat(500_000)}"]`;
    expect(() => validatePayload(definition, { data: hugeString })).toThrow('data exceeds max length 500000');
    const stringAtLimit = `"${'x'.repeat(500_000 - 2)}"`;
    expect(validatePayload(definition, { data: stringAtLimit })).toEqual({ data: stringAtLimit });
    const hugeObject = { value: 'x'.repeat(500_001) };
    expect(() => validatePayload(definition, { data: hugeObject })).toThrow('data exceeds max length 500000');
    const objectAtLimit = { value: 'x'.repeat(500_000 - JSON.stringify({ value: '' }).length) };
    expect(validatePayload(definition, { data: objectAtLimit })).toEqual({ data: objectAtLimit });
  });

  it('passes through unknown field types as raw values', () => {
    const definition = resource([{ name: 'custom', type: 'custom' as never }]);
    expect(validatePayload(definition, { custom: { nested: true } })).toEqual({ custom: { nested: true } });
  });
});
