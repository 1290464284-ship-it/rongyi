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
  });
});
