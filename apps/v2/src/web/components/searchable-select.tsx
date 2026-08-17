import { useEffect, useRef } from 'react';
import { friendlyError } from '../lib/messages';
import { MissingSelectOption } from './list-controls';
import { useRemoteSearch } from '../hooks/use-remote-search';

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
  const {
    search,
    setSearch,
    loadMore,
    loaded,
    data,
    isFetching,
    error,
    canLoadMore,
    loadCapped,
  } = useRemoteSearch<SearchableSelectRow>({
    resource,
    pageSize,
    filterParams,
    queryKeyPrefix: 'searchable-select',
    trimSearch: true,
    mergeMode: 'merge',
  });

  const onLoadedRef = useRef(onLoaded);
  useEffect(() => {
    onLoadedRef.current = onLoaded;
  });
  useEffect(() => {
    if (data) onLoadedRef.current?.(loaded);
  }, [loaded, data]);

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
        onChange={(event) => setSearch(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.preventDefault();
        }}
      />
      {canLoadMore && (loadCapped ? (
        <span className="searchable-select-cap">数据较多，仅展示前 {loaded.length} 条，请使用搜索筛选</span>
      ) : (
        <button type="button" className="btn-secondary" disabled={isFetching} onClick={loadMore}>
          加载更多（已加载 {loaded.length} 条）
        </button>
      ))}
      {error && <span className="error">{friendlyError(error)}</span>}
    </span>
  );
}
