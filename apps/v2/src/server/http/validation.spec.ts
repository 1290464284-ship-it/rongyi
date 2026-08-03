import { describe, expect, it } from 'vitest';
import { validatePayload } from './validation';
import type { ResourceDefinition } from '../../domain/contracts';

const definition: ResourceDefinition = {
  name: 'test',
  table: 'Test',
  fields: [
    { name: 'name', type: 'text', required: true, maxLength: 5 },
    { name: 'age', type: 'number', min: 0, max: 100 },
    { name: 'role', type: 'enum', enumValues: ['A', 'B'] },
    { name: 'active', type: 'boolean' },
    { name: 'data', type: 'json' },
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
    expect(() => validatePayload(definition, { name: '123456' })).toThrow('exceeds max length');
  });
});

