import { describe, expect, it } from 'vitest';
import { validatePayload } from './validation';
import type { ResourceDefinition } from '../../domain/contracts';

const definition: ResourceDefinition = {
  name: 'test',
  table: 'Test',
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 5 },
    { name: 'age', type: 'number', min: 0, max: 100 },
    { name: 'amount', type: 'money' },
    { name: 'role', type: 'enum', enumValues: ['A', 'B'] },
    { name: 'active', type: 'boolean' },
    { name: 'data', type: 'json' },
    { name: 'day', type: 'date' },
    { name: 'startsAt', type: 'datetime' },
    { name: 'ratio', type: 'decimal', min: 0, max: 10 },
    { name: 'ratioDefault', type: 'decimal', default: 0.25 },
  ],
  searchableFields: ['name'],
  defaultSort: { field: 'name', order: 'ASC' },
  capabilities: { list: true, create: true, update: true, delete: true, softDelete: true },
  roles: ['BOSS'],
};

describe('validatePayload', () => {
  it('validates required and type fields', () => {
    expect(() => validatePayload(definition, { age: 5 })).toThrow('name is required');
    expect(validatePayload(definition, { name: 'A', age: 5, role: 'A', active: true, data: { x: 1 } }))
      .toMatchObject({ name: 'A', age: 5, role: 'A', active: true });
    expect(() => validatePayload(definition, { name: 'A', age: 101 })).toThrow('age must be <= 100');
    expect(() => validatePayload(definition, { name: 'A', role: 'X' })).toThrow('role must be one of');
    expect(() => validatePayload(definition, { name: 'REDACTED' })).toThrow('exceeds max length');
    expect(() => validatePayload(definition, { name: 'A', amount: 12.5 })).toThrow('integer amount in cents');
    expect(() => validatePayload(definition, { name: 'A', age: true })).toThrow('age must be a number');
    expect(validatePayload(definition, { name: 'A', amount: 1250 }).amount).toBe(1250);
    expect(() => validatePayload(definition, { name: 'A', day: '2026-13-01' })).toThrow('valid YYYY-MM-DD');
    expect(() => validatePayload(definition, { name: 'A', day: '2026-02-30' })).toThrow('valid YYYY-MM-DD');
    expect(() => validatePayload(definition, { name: 'A', startsAt: 'not-a-date' })).toThrow('valid date-time');
    expect(validatePayload(definition, { name: 'A', day: '2026-08-01', startsAt: '2026-08-01T00:00:00.000Z' }))
      .toMatchObject({ day: '2026-08-01', startsAt: '2026-08-01T00:00:00.000Z' });
    expect(validatePayload(definition, { name: 'A', ratio: 0.75 }).ratio).toBe(0.75);
    expect(validatePayload(definition, { name: 'A', ratio: '0.5' }).ratio).toBe(0.5);
    expect(() => validatePayload(definition, { name: 'A', ratio: 'abc' })).toThrow('ratio must be a number');
    expect(() => validatePayload(definition, { name: 'A', ratio: 11 })).toThrow('ratio must be <= 10');
    expect(validatePayload(definition, { name: 'A' }).ratioDefault).toBe(0.25);
  });

  it('normalizes datetime values to UTC ISO', () => {
    const withOffset = validatePayload(definition, { name: 'A', startsAt: '2026-08-05T10:00:00+08:00' });
    const withZ = validatePayload(definition, { name: 'A', startsAt: '2026-08-05T02:00:00.000Z' });
    expect(withOffset.startsAt).toBe('2026-08-05T02:00:00.000Z');
    expect(withZ.startsAt).toBe('2026-08-05T02:00:00.000Z');
    expect(withOffset.startsAt).toBe(withZ.startsAt);
  });

  it('rejects invalid datetime values', () => {
    expect(() => validatePayload(definition, { name: 'A', startsAt: 'not-a-date' })).toThrow('valid date-time');
    expect(() => validatePayload(definition, { name: 'A', startsAt: '2026-02-30T10:00:00.000Z' })).toThrow('valid date-time');
    expect(() => validatePayload(definition, { name: 'A', startsAt: '2026-02-29T10:00:00.000Z' })).toThrow('valid date-time');
  });
});
