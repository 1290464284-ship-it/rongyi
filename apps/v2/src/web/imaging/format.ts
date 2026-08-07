import { PHASE_LABELS } from './constants';
import type { ImagingCategoryRow, ImagingRow } from './types';

export function formatDateTime(value?: string | null): string {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '';
}

export function toLocalDatetime(value: unknown): string {
  if (!value) return '';
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function phaseLabel(phase?: string | null): string {
  if (!phase) return '';
  return PHASE_LABELS[phase] ?? phase;
}

export function imagingOptionLabel(row: ImagingRow): string {
  const takenAt = formatDateTime(row.takenAt);
  return takenAt ? `${String(row.title ?? row.id)}（${takenAt}）` : String(row.title ?? row.id);
}

export function categoryName(row: ImagingRow, categories: ImagingCategoryRow[]): string {
  if (!row.categoryId) return '';
  const category = categories.find((item) => item.id === row.categoryId);
  return category?.name ?? row.categoryId;
}
