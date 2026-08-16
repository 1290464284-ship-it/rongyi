import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import type { Page } from '../lib/types';
import { useDebouncedValue } from './use-debounce';

const MAX_LOAD_PAGES = 10;

export interface RemoteSearchRow extends Record<string, unknown> {
  id?: string | null;
}

type RemoteSearchMergeMode = 'replace' | 'merge';

export interface UseRemoteSearchOptions {
  resource: string;
  pageSize?: number;
  filterParams?: Record<string, string>;
  debounceMs?: number;
  /** 翻页时用上一页数据占位（保留 RelationSelect 的 placeholderData 语义）。 */
  keepPreviousData?: boolean;
  /** 请求前是否 trim 搜索词（SearchableSelect 会 trim，RelationSelect 不会）。 */
  trimSearch?: boolean;
  queryKeyPrefix?: string;
  /**
   * 累计策略：replace 在回到第 1 页/空累计时整体替换、其余按 id 去重追加（RelationSelect）；
   * merge 始终按 id 合并（SearchableSelect）。
   */
  mergeMode?: RemoteSearchMergeMode;
  /** 是否还有更多数据（默认 total > loadedCount）。 */
  canLoadMore?: (ctx: { page: number; pageSize: number; total: number; loadedCount: number }) => boolean;
}

export interface RemoteSearchState<T extends RemoteSearchRow> {
  search: string;
  setSearch: (value: string) => void;
  page: number;
  loadMore: () => void;
  loaded: T[];
  data: Page<T> | undefined;
  isPlaceholderData: boolean;
  isFetching: boolean;
  error: Error | null;
  total: number;
  canLoadMore: boolean;
  loadCapped: boolean;
}

function mergeLoaded<T extends RemoteSearchRow>(
  current: T[],
  incoming: T[],
  page: number,
  mode: RemoteSearchMergeMode,
): T[] {
  if (mode === 'replace') {
    if (page === 1 || current.length === 0) return incoming;
    const seen = new Set(current.map((item) => String(item.id)));
    const fresh = incoming.filter((item) => !seen.has(String(item.id)));
    return fresh.length > 0 ? [...current, ...fresh] : current;
  }
  const byId = new Map<string, T>();
  for (const row of current) byId.set(String(row.id), row);
  for (const row of incoming) byId.set(String(row.id), row);
  return Array.from(byId.values());
}

export function useRemoteSearch<T extends RemoteSearchRow>({
  resource,
  pageSize = 50,
  filterParams,
  debounceMs = 300,
  keepPreviousData = false,
  trimSearch = false,
  queryKeyPrefix = 'remote-search',
  mergeMode = 'merge',
  canLoadMore,
}: UseRemoteSearchOptions): RemoteSearchState<T> {
  const [search, setSearchState] = useState('');
  const debouncedSearch = useDebouncedValue(search, debounceMs);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState<T[]>([]);
  const filterKey = JSON.stringify(filterParams ?? {});
  const scopeKey = `${resource}:${filterKey}`;
  const [prevScope, setPrevScope] = useState(scopeKey);
  const queryKey = [queryKeyPrefix, resource, debouncedSearch, page, filterKey];
  const queryKeyJson = JSON.stringify(queryKey);
  const [prevSnapshot, setPrevSnapshot] = useState<{ key: string; data: Page<T> | undefined } | undefined>(undefined);

  // 作用域（资源或筛选参数）变化时重置搜索/页码/累计，避免旧数据串到新作用域。
  if (prevScope !== scopeKey) {
    setPrevScope(scopeKey);
    setSearchState('');
    setPage(1);
    setLoaded([]);
    setPrevSnapshot(undefined);
  }

  const query = useQuery<Page<T>, Error>({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const trimmed = trimSearch ? debouncedSearch.trim() : debouncedSearch;
      if (trimmed !== '') params.set('search', trimmed);
      if (filterParams) {
        for (const [key, value] of Object.entries(filterParams)) {
          if (value !== undefined && value !== null && value !== '') params.set(key, value);
        }
      }
      return apiRequest<Page<T>>(`/resources/${resource}?${params.toString()}`);
    },
    ...(keepPreviousData ? { placeholderData: (previous: Page<T> | undefined) => previous } : {}),
  });

  // 渲染期调整（React 官方模式）：仅同一查询键的新数据到达时合并，
  // 搜索/翻页/作用域变化后的旧数据不再被合并回来。
  if (!prevSnapshot || prevSnapshot.key !== queryKeyJson || prevSnapshot.data !== query.data) {
    const previous = prevSnapshot;
    setPrevSnapshot({ key: queryKeyJson, data: query.data });
    if ((previous === undefined || previous.key === queryKeyJson) && query.data) {
      const incoming = query.data.items;
      const shouldMerge = mergeMode === 'replace' ? Boolean(incoming) : (incoming ?? []).length > 0;
      if (shouldMerge) {
        setLoaded((current) => mergeLoaded(current, incoming as T[], page, mergeMode));
      }
    }
  }

  const total = keepPreviousData && query.isPlaceholderData
    ? loaded.length
    : (query.data?.total ?? (keepPreviousData ? loaded.length : 0));
  const hasMore = canLoadMore ?? ((ctx) => ctx.total > ctx.loadedCount);
  const more = hasMore({ page, pageSize, total, loadedCount: loaded.length });
  const loadCapped = more && page >= MAX_LOAD_PAGES;

  const setSearch = (value: string) => {
    setSearchState(value);
    setPage(1);
    setLoaded([]);
  };

  const loadMore = () => setPage((current) => current + 1);

  return {
    search,
    setSearch,
    page,
    loadMore,
    loaded,
    data: query.data,
    isPlaceholderData: query.isPlaceholderData,
    isFetching: query.isFetching,
    error: query.error,
    total,
    canLoadMore: more,
    loadCapped,
  };
}
