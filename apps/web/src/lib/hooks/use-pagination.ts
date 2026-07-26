/**
 * 分页状态管理 Hook
 *
 * 封装分页状态（page / pageSize / 总数），配合 useCrudPaginated 使用。
 * 提供 goToPage / nextPage / prevPage / setPageSize 等方法。
 *
 * @example
 * const { page, pageSize, setPage, setPageSize } = usePaginationState();
 * const { data } = useCrudPaginated('patients', 'patient', { page, pageSize });
 */
import { useState, useCallback, useMemo } from 'react';
import { PAGINATION } from '@dental/shared';

export interface PaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  setTotal: (total: number) => void;
  nextPage: () => void;
  prevPage: () => void;
  isFirstPage: boolean;
  isLastPage: boolean;
}

export function usePaginationState(defaultPageSize: number = PAGINATION.DEFAULT_PAGE_SIZE): PaginationState {
  const [page, setPageState] = useState(1);
  const [pageSize, setPageSizeState] = useState(defaultPageSize);
  const [total, setTotal] = useState(0);

  const totalPages = useMemo(
    () => (total > 0 ? Math.ceil(total / pageSize) : 0),
    [total, pageSize],
  );

  const setPage = useCallback((p: number) => {
    setPageState(Math.max(1, p));
  }, []);

  const setPageSize = useCallback((size: number) => {
    setPageSizeState(Math.min(Math.max(1, size), PAGINATION.MAX_PAGE_SIZE));
    setPageState(1); // 切换每页条数时回到第一页
  }, []);

  const nextPage = useCallback(() => {
    setPageState(p => p + 1);
  }, []);

  const prevPage = useCallback(() => {
    setPageState(p => Math.max(1, p - 1));
  }, []);

  return {
    page,
    pageSize,
    total,
    totalPages,
    setPage,
    setPageSize,
    setTotal,
    nextPage,
    prevPage,
    isFirstPage: page <= 1,
    isLastPage: totalPages > 0 && page >= totalPages,
  };
}
