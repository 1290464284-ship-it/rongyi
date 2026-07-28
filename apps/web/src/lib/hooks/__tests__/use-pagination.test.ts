import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePaginationState } from '@/lib/hooks/use-pagination';

describe('usePaginationState', () => {
  it('默认状态为第 1 页 / 每页 20 条 / 总数 0', () => {
    const { result } = renderHook(() => usePaginationState());
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(20);
    expect(result.current.total).toBe(0);
    expect(result.current.totalPages).toBe(0);
    expect(result.current.isFirstPage).toBe(true);
    expect(result.current.isLastPage).toBe(false);
  });

  it('setTotal 后计算 totalPages 并感知末页', () => {
    const { result } = renderHook(() => usePaginationState(10));
    act(() => result.current.setTotal(25));
    expect(result.current.totalPages).toBe(3);

    act(() => result.current.setPage(3));
    expect(result.current.isLastPage).toBe(true);
    expect(result.current.isFirstPage).toBe(false);
  });

  it('setPage 钳制最小值为 1', () => {
    const { result } = renderHook(() => usePaginationState());
    act(() => result.current.setPage(-5));
    expect(result.current.page).toBe(1);
  });

  it('setPageSize 钳制在 [1, MAX_PAGE_SIZE] 并回到第一页', () => {
    const { result } = renderHook(() => usePaginationState());
    act(() => result.current.setPage(3));
    act(() => result.current.setPageSize(9999));
    expect(result.current.pageSize).toBe(200);
    expect(result.current.page).toBe(1);

    act(() => result.current.setPageSize(0));
    expect(result.current.pageSize).toBe(1);
  });

  it('nextPage / prevPage 前后翻页，prevPage 不低于第 1 页', () => {
    const { result } = renderHook(() => usePaginationState());
    act(() => result.current.nextPage());
    expect(result.current.page).toBe(2);

    act(() => result.current.prevPage());
    act(() => result.current.prevPage());
    expect(result.current.page).toBe(1);
  });
});
