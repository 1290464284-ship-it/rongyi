import { ValidationError } from '../infrastructure/errors';
import type { ResourceDefinition, ResourceField } from '../../domain/contracts';

/**
 * Validates generic resource payloads using the declarative field metadata.
 */
export function validatePayload(
  resource: ResourceDefinition,
  payload: Record<string, unknown>,
  options: { partial?: boolean } = {},
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of resource.fields) {
    const raw = payload[field.name];
    if (raw === undefined || raw === null) {
      if (field.required && !options.partial) throw new ValidationError(`${field.name} is required`);
      if (raw === undefined && field.default !== undefined && !options.partial) {
        result[field.name] = validateField(field, field.default);
      }
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
    case 'relation':
      if (typeof raw !== 'string') throw new ValidationError(`${field.name} must be a string`);
      if (field.maxLength && raw.length > field.maxLength) {
        throw new ValidationError(`${field.name} exceeds max length ${field.maxLength}`);
      }
      return raw;
    case 'date':
      if (typeof raw !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw) || Number.isNaN(new Date(`${raw}T00:00:00.000Z`).getTime())) {
        throw new ValidationError(`${field.name} must be a valid YYYY-MM-DD date`);
      }
      return raw;
    case 'datetime':
      if (typeof raw !== 'string' || Number.isNaN(Date.parse(raw))) {
        throw new ValidationError(`${field.name} must be a valid date-time`);
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
