import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest } from '../lib/api';
import type { Page } from '../lib/types';
import { friendlyError } from '../lib/messages';
import { useDebouncedValue } from '../hooks/use-debounce';
import { MissingSelectOption } from './list-controls';

export interface SearchableSelectRow extends Record<string, unknown> {
  id: string;
}

export function SearchableSelect({
  resource,
  labelField = 'name',
  placeholder = '选择',
  value,
  onChange,
  ariaLabel,
  filterParams,
  pageSize = 100,
  onLoaded,
}: {
  resource: string;
  labelField?: string;
  placeholder?: string;
  value: string;
  onChange: (id: string) => void;
  ariaLabel: string;
  filterParams?: Record<string, string>;
  pageSize?: number;
  onLoaded?: (rows: SearchableSelectRow[]) => void;
}) {
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  const [page, setPage] = useState(1);
  // 已加载并去重的条目：搜索变化时清空，加载更多时按 id 追加合并。
  const [loaded, setLoaded] = useState<SearchableSelectRow[]>([]);
  const filterKey = JSON.stringify(filterParams ?? {});
  const scopeKey = `${resource}:${filterKey}`;
  const [prevScope, setPrevScope] = useState(scopeKey);
  const queryKey = ['searchable-select', resource, debouncedSearch, page, filterKey];
  const queryKeyJson = JSON.stringify(queryKey);
  const [prevSnapshot, setPrevSnapshot] = useState<{ key: string; data: Page<SearchableSelectRow> | undefined } | undefined>(undefined);
  if (prevScope !== scopeKey) {
    setPrevScope(scopeKey);
    setSearch('');
    setPage(1);
    setLoaded([]);
    setPrevSnapshot(undefined);
  }

  const query = useQuery({
    queryKey,
    queryFn: () => {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('pageSize', String(pageSize));
      const trimmed = debouncedSearch.trim();
      if (trimmed !== '') params.set('search', trimmed);
      if (filterParams) {
        for (const [key, value] of Object.entries(filterParams)) {
          if (value !== undefined && value !== null && value !== '') params.set(key, value);
        }
      }
      return apiRequest<Page<SearchableSelectRow>>(`/resources/${resource}?${params.toString()}`);
    },
  });

  // 渲染期调整（React 官方模式）：仅同一查询键的新数据到达时合并；
  // 搜索/翻页/作用域变化后的旧数据不再被合并回来。
  if (!prevSnapshot || prevSnapshot.key !== queryKeyJson || prevSnapshot.data !== query.data) {
    const previous = prevSnapshot;
    setPrevSnapshot({ key: queryKeyJson, data: query.data });
    if ((previous === undefined || previous.key === queryKeyJson) && query.data) {
      const incomingItems = query.data.items ?? [];
      if (incomingItems.length > 0) {
      setLoaded((current) => {
        const byId = new Map<string, SearchableSelectRow>();
        for (const row of current) byId.set(String(row.id), row);
        for (const row of incomingItems) byId.set(String(row.id), row);
        return Array.from(byId.values());
      });
      }
    }
  }

  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });
  useEffect(() => {
    if (query.data) onLoadedRef.current?.(loaded);
  }, [loaded, query.data]);

  const total = query.data?.total ?? 0;
  // M1：滚动加载设页数上限（10 页），超限停止自动加载并提示改用搜索，避免大资源全量持有
  const MAX_LOAD_PAGES = 10;
  const canLoadMore = total > loaded.length;
  const loadCapped = canLoadMore && page >= MAX_LOAD_PAGES;
  const selectedMissing = value !== '' && !loaded.some((row) => String(row.id) === value);

  return (
    <span className="searchable-select">
      <select aria-label={ariaLabel} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {selectedMissing && <MissingSelectOption value={value} />}
        {loaded.map((row) => (
          <option key={String(row.id)} value={String(row.id)}>
            {String(row[labelField] ?? row.id)}
          </option>
        ))}
      </select>
      <input
        aria-label={`${ariaLabel}搜索`}
        placeholder="搜索…"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
          setLoaded([]);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
      />
      {canLoadMore && (loadCapped ? (
        <span className="searchable-select-cap">数据较多，仅展示前 {loaded.length} 条，请使用搜索筛选</span>
      ) : (
        <button type="button" className="btn-secondary" disabled={query.isFetching} onClick={() => setPage((current) => current + 1)}>
          加载更多（已加载 {loaded.length} 条）
        </button>
      ))}
      {query.error && <span className="error">{friendlyError(query.error)}</span>}
    </span>
  );
}
