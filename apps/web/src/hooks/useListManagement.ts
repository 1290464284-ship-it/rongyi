import { useState, useMemo, useCallback } from 'react';

/**
 * 共享列表管理 hook：搜索 + 筛选 + 分页
 * 用于 DebtsTab / CombosTab 等列表页面的通用状态管理
 */
export function useListManagement<TFilter extends Record<string, string>>({
  defaultFilters,
  pageSize = 10,
  debounceMs = 350,
}: {
  defaultFilters: TFilter;
  pageSize?: number;
  debounceMs?: number;
}) {
  const [keyword, setKeyword] = useState('');
  const [debouncedKeyword, setDebouncedKeyword] = useState('');
  const [filters, setFilters] = useState<TFilter>(defaultFilters);
  const [page, setPage] = useState(1);

  // 关键字防抖
  const keywordTimerRef = useMemo(() => ({ current: 0 as unknown as ReturnType<typeof setTimeout> }), []);
  const handleKeywordChange = useCallback((value: string) => {
    setKeyword(value);
    clearTimeout(keywordTimerRef.current);
    keywordTimerRef.current = setTimeout(() => {
      setDebouncedKeyword(value);
      setPage(1);
    }, debounceMs);
  }, [keywordTimerRef, debounceMs]);

  // 更新单个筛选条件并重置分页
  const updateFilter = useCallback(<K extends keyof TFilter>(key: K, value: TFilter[K]) => {
    setFilters(prev => ({ ...prev, [key]: value }));
    setPage(1);
  }, []);

  // 分页计算
  const pagination = useCallback((total: number) => {
    const totalPages = Math.ceil(total / pageSize);
    return {
      totalPages,
      canPrev: page > 1,
      canNext: page < totalPages,
      goPrev: () => setPage(p => Math.max(1, p - 1)),
      goNext: () => setPage(p => Math.min(totalPages, p + 1)),
    };
  }, [page, pageSize]);

  return {
    keyword,
    debouncedKeyword,
    handleKeywordChange,
    filters,
    updateFilter,
    page,
    setPage,
    pageSize,
    pagination,
  };
}
