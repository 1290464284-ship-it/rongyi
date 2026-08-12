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
      if (field.required && raw.trim() === '') throw new ValidationError(`${field.name} is required`);
      if (field.maxLength && raw.length > field.maxLength) {
        throw new ValidationError(`${field.name} exceeds max length ${field.maxLength}`);
      }
      return raw;
    case 'date':
      if (
        typeof raw !== 'string'
        || !/^\d{4}-\d{2}-\d{2}$/.test(raw)
        || Number.isNaN(new Date(`${raw}T00:00:00.000Z`).getTime())
        || new Date(`${raw}T00:00:00.000Z`).toISOString().slice(0, 10) !== raw
      ) {
        throw new ValidationError(`${field.name} must be a valid YYYY-MM-DD date`);
      }
      return raw;
    case 'datetime': {
      const isoDatetime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
      if (typeof raw !== 'string' || !isoDatetime.test(raw) || Number.isNaN(Date.parse(raw))) {
        throw new ValidationError(`${field.name} must be a valid date-time`);
      }
      // Date.parse 会把 2026-02-30 / 非闰年 02-29 静默规范化，必须先拒绝不存在的日历日期。
      const calendarMatch = /^(\d{4})-(\d{2})-(\d{2})/.exec(raw);
      if (calendarMatch) {
        const year = Number(calendarMatch[1]);
        const month = Number(calendarMatch[2]);
        const day = Number(calendarMatch[3]);
        const probe = new Date(Date.UTC(year, month - 1, day));
        if (
          probe.getUTCFullYear() !== year
          || probe.getUTCMonth() !== month - 1
          || probe.getUTCDate() !== day
        ) {
          throw new ValidationError(`${field.name} must be a valid date-time`);
        }
      }
      const normalized = new Date(raw).toISOString();
      if (Number.isNaN(new Date(normalized).getTime())) {
        throw new ValidationError(`${field.name} must be a valid date-time`);
      }
      return normalized;
    }
    case 'decimal': {
      const value = typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : Number.NaN;
      if (!Number.isFinite(value)) throw new ValidationError(`${field.name} must be a number`);
      if (field.min !== undefined && value < field.min) throw new ValidationError(`${field.name} must be >= ${field.min}`);
      if (field.max !== undefined && value > field.max) throw new ValidationError(`${field.name} must be <= ${field.max}`);
      return value;
    }
    case 'number':
    case 'money': {
      const value = typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && raw.trim() !== ''
          ? Number(raw)
          : Number.NaN;
      if (!Number.isFinite(value)) throw new ValidationError(`${field.name} must be a number`);
      if (!Number.isInteger(value)) throw new ValidationError(`${field.name} must be an integer amount in cents`);
      if (field.type === 'money') {
        if (value < 0) throw new ValidationError(`${field.name} must be non-negative`);
        if (value > 1_000_000_00) throw new ValidationError(`${field.name} exceeds maximum amount of 100000000 cents (1000000.00)`);
      }
      if (field.min !== undefined && value < field.min) throw new ValidationError(`${field.name} must be >= ${field.min}`);
      if (field.max !== undefined && value > field.max) throw new ValidationError(`${field.name} must be <= ${field.max}`);
      return value;
    }
    case 'boolean':
      // B-L4：'1' 字符串（表单/CSV/同步客户端常见）与布尔 true 等价，与 repository.serialize 保持一致；
      // 非法值必须显式拒绝，避免把数组/对象静默当成 false（与权限布尔解析一致）。
      if (raw === true || raw === 1 || raw === 'true' || raw === '1') return true;
      if (raw === false || raw === 0 || raw === 'false' || raw === '0') return false;
      throw new ValidationError(`${field.name} must be a boolean`);
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
