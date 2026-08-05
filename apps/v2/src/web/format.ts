import type { ResourceField } from './types';

export function toCents(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100 + Number.EPSILON * 100);
}

export function formatMoney(value: unknown): string {
  if (value === null || value === undefined) return '';
  const cents = Number(value);
  if (!Number.isFinite(cents)) return String(value);
  return `¥${(cents / 100).toFixed(2)}`;
}

export function formatDate(value: unknown): string {
  if (!value) return '';
  const date = new Date(`${String(value)}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) return String(value);
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
