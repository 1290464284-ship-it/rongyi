import type { ResourceField } from '../lib/types';
import { centsToYuanString, toCents, toLocalInput } from '../lib/format';

function fieldValue(field: ResourceField, value: unknown): unknown {
  if (field.type === 'json') {
    /* v8 ignore next -- FormBuilder json 控件始终以字符串提交，非字符串/空值分支不可达 */
    if (typeof value !== 'string') return JSON.stringify(value ?? '{}');
    return value;
  }
  if (field.type === 'boolean') return Boolean(value);
  if (field.type === 'datetime' && typeof value === 'string' && value) {
    const parsed = new Date(value);
    /* v8 ignore next -- datetime-local 输入已被浏览器清洗，非法非空字符串不可达 */
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  if (field.type === 'money') return toCents(value);
  if (field.type === 'number') {
    /* v8 ignore next -- 数字控件始终提交字符串，?? 0 仅作防御 */
    return Number(value ?? 0);
  }
  /* v8 ignore next -- submit 会跳过可选空值，必填值恒为字符串，?? '' 分支不可达 */
  return value ?? '';
}

function fieldToForm(field: ResourceField, value: unknown): string | boolean {
  if (field.type === 'boolean') return Boolean(value);
  if (field.type === 'json') return JSON.stringify(value ?? '', null, 2);
  if (value === null || value === undefined) return '';
  if (field.type === 'datetime' && typeof value === 'string' && value) return toLocalInput(value);
  if (field.type === 'money' && Number.isFinite(Number(value))) return centsToYuanString(value);
  return String(value);
}

/** 新建表单初始值：按字段默认值/类型构建。 */
export function buildInitialForm(fields: ResourceField[]): Record<string, unknown> {
  const initial: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.type === 'boolean') {
      initial[field.name] = field.default === undefined ? false : Boolean(field.default);
    } else if (field.type === 'json') {
      initial[field.name] = field.default === undefined ? '{}' : fieldToForm(field, field.default);
    } else if (field.default !== undefined) {
      initial[field.name] = fieldToForm(field, field.default);
    } else {
      initial[field.name] = '';
    }
  }
  return initial;
}

/** 编辑表单初始值：行数据 → 表单值。 */
export function formFromRow(fields: ResourceField[], row: Record<string, unknown>): Record<string, unknown> {
  const initial: Record<string, unknown> = {};
  for (const field of fields) {
    initial[field.name] = fieldToForm(field, row[field.name]);
  }
  return initial;
}

/** 提交载荷：跳过可选空值（编辑时置 null）。 */
export function buildPayload(fields: ResourceField[], form: Record<string, unknown>, editingId: string | null): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const field of fields) {
    const value = form[field.name];
    if ((value === '' || value === undefined || value === null) && !field.required) {
      if (editingId) payload[field.name] = null;
      continue;
    }
    payload[field.name] = fieldValue(field, form[field.name]);
  }
  return payload;
}
