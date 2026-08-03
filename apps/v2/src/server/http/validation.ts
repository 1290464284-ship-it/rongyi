import { ValidationError } from '../infrastructure/errors';
import type { ResourceDefinition, ResourceField } from '../../domain/contracts';

/**
 * Validates generic resource payloads using the declarative field metadata.
 */
export function validatePayload(resource: ResourceDefinition, payload: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of resource.fields) {
    const raw = payload[field.name];
    if (raw === undefined || raw === null) {
      if (field.required) throw new ValidationError(`${field.name} is required`);
      continue;
    }
    result[field.name] = validateField(field, raw);
  }
  return result;
}

function validateField(field: ResourceField, raw: unknown): unknown {
  switch (field.type) {
    case 'text':
    case 'longText':
    case 'date':
    case 'datetime':
    case 'relation':
      if (typeof raw !== 'string') throw new ValidationError(`${field.name} must be a string`);
      if (field.maxLength && raw.length > field.maxLength) {
        throw new ValidationError(`${field.name} exceeds max length ${field.maxLength}`);
      }
      return raw;
    case 'number':
    case 'money': {
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new ValidationError(`${field.name} must be a number`);
      if (!Number.isInteger(value)) throw new ValidationError(`${field.name} must be an integer amount in cents`);
      if (field.min !== undefined && value < field.min) throw new ValidationError(`${field.name} must be >= ${field.min}`);
      if (field.max !== undefined && value > field.max) throw new ValidationError(`${field.name} must be <= ${field.max}`);
      return value;
    }
    case 'boolean':
      return raw === true || raw === 1 || raw === 'true';
    case 'enum':
      if (typeof raw !== 'string' || !field.enumValues?.includes(raw)) {
        throw new ValidationError(`${field.name} must be one of ${field.enumValues?.join(', ')}`);
      }
      return raw;
    case 'json':
      if (typeof raw === 'string') return raw;
      if (Array.isArray(raw) || (typeof raw === 'object' && raw !== null)) return raw;
      throw new ValidationError(`${field.name} must be JSON-compatible`);
    default:
      return raw;
  }
}
