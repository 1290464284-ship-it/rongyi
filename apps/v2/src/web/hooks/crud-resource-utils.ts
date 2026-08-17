import type { Page } from '../lib/types';
import type { CrudListParams } from './crud-resource-types';

export const DEFAULT_MESSAGES = { create: '创建成功', update: '更新成功', delete: '删除成功' };
export const DEFAULT_ERROR_MESSAGES = { create: '创建失败', update: '更新失败', delete: '删除失败' };

// ── 乐观更新缓存补丁（审计 P2：写操作先打补丁、后台 refetch 校准）──────────
type RowLike = Record<string, unknown>;

export function patchItems<T extends RowLike>(data: Page<T> | undefined, id: string, patch: RowLike): Page<T> | undefined {
  if (!data) return data;
  return {
    ...data,
    items: data.items.map((row) => (String(row.id) === id ? { ...row, ...patch } : row)),
  };
}

export function prependItem<T extends RowLike>(data: Page<T> | undefined, row: T): Page<T> | undefined {
  if (!data) return data;
  return { ...data, items: [row, ...data.items], total: (data.total ?? 0) + 1 };
}

export function removeItem<T extends RowLike>(data: Page<T> | undefined, id: string): Page<T> | undefined {
  if (!data) return data;
  return {
    ...data,
    items: data.items.filter((row) => String(row.id) !== id),
    total: Math.max(0, (data.total ?? 0) - 1),
  };
}

export function freshInitial<TForm extends object>(initialForm: TForm | (() => TForm)): TForm {
  return typeof initialForm === 'function' ? initialForm() : { ...initialForm };
}

export function pickFormFromRow<TForm extends object, TRow extends Record<string, unknown>>(
  initialForm: TForm | (() => TForm),
  row: TRow,
): TForm {
  const base = freshInitial(initialForm);
  const form = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(base)) {
    const value = row[key];
    if (value !== undefined) form[key] = value;
  }
  return form as TForm;
}

export function buildDefaultListPath(endpoint: string, pageSize: number, params: CrudListParams): string {
  const query = `page=${params.page}&pageSize=${pageSize}`;
  const searchPart = params.search ? `&search=${encodeURIComponent(params.search)}` : '';
  return `${endpoint}?${query}${searchPart}`;
}

export function resolveCursorListPath(
  resolve: (params: CrudListParams) => string,
  search: string,
  cursor: string | null,
): string {
  const base = resolve({ page: 1, search });
  if (!cursor) return base;
  const [pathPart, queryPart = ''] = base.split('?', 2);
  const params = new URLSearchParams(queryPart);
  params.set('cursor', cursor);
  return `${pathPart}?${params.toString()}`;
}
