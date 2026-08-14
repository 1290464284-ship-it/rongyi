import type { ResourceField } from './types';

export function toCents(value: unknown): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.round(numeric * 100 + Number.EPSILON * 100);
}

export function formatMoney(value: unknown): string {
  if (value === null || value === undefined) return '';
  const cents = Number(value);
  if (!Number.isFinite(cents)) return String(value);
  return `¥${(cents / 100).toFixed(2)}`;
}

/** 分 → 元字符串（两位小数、无 ¥ 前缀）；null/undefined/空串返回 ''，非有限值原样返回。 */
export function centsToYuanString(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  const cents = Number(value);
  if (!Number.isFinite(cents)) return String(value);
  return (cents / 100).toFixed(2);
}

/** 按中英文逗号拆分去空白并过滤空项（牙位号、图片列表等共用）。 */
export function splitList(value: string): string[] {
  return value
    .split(/[,，]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatDate(value: unknown): string {
  if (!value) return '';
  const text = String(value);
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (dateOnly) {
    const local = new Date(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]));
    /* v8 ignore next -- 四位年份的 Date 构造恒产生有效日期（越界会滚动），NaN 分支不可达，防御冗余 */
    if (!Number.isNaN(local.getTime())) return local.toLocaleDateString('zh-CN');
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return text;
  return date.toLocaleDateString('zh-CN');
}

export function formatDateTime(value: unknown): string {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN', { hour12: false });
}

export function formatDisplayValue(value: unknown, field?: ResourceField): string {
  if (value === null || value === undefined) return '';
  if (field?.type === 'boolean') return value ? '是' : '否';
  if (field?.format === 'money') return formatMoney(value);
  if (field?.format === 'datetime') return formatDateTime(value);
  if (field?.format === 'date') return formatDate(value);
  if (field?.type === 'enum' && field.enumLabels) return field.enumLabels[String(value)] ?? String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function todayLocalDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/** Convert an ISO string to a datetime-local input value in the user's local timezone. */
export function toLocalInput(iso?: unknown): string {
  if (typeof iso !== 'string' || !iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
