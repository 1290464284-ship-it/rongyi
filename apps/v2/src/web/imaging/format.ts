import { formatDateTime, toLocalInput } from '../lib/format';
import { PHASE_LABELS } from './constants';
import type { ImagingCategoryRow, ImagingRow } from './types';

// 与 lib/format 同口径（行为差异仅限无效日期：lib 版原样返回而非 "Invalid Date"）。
export { formatDateTime };
export { toLocalInput as toLocalDatetime };

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
