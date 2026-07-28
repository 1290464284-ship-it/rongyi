import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { toastService } from '@/lib/utils/toast-service';
import { createQueryWrapper } from '@/test/query-test-utils';
import {
  useCrudList,
  useCrudPaginated,
  useCrudItem,
  useCrudCreate,
  useCrudUpdate,
  useCrudDelete,
  createCrudHooks,
  createPaginatedCrudHooks,
} from '@/lib/hooks/use-crud';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

vi.mock('@/lib/utils/toast-service', () => ({
  toastService: {
    error: vi.fn(),
    success: vi.fn(),
    createError: vi.fn(),
    updateError: vi.fn(),
    deleteError: vi.fn(),
  },
}));

const mockedApi = vi.mocked(api);
const mockedToast = vi.mocked(toastService);

describe('use-crud 工厂 hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useCrudList 返回 items 数组', async () => {
    mockedApi.get.mockResolvedValue({ data: { items: [{ id: '1' }], total: 1, page: 1, pageSize: 20 } });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCrudList('things', 'things', { page: 1 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/things', { params: { page: 1 } });
    expect(result.current.data).toEqual([{ id: '1' }]);
  });

  it('useCrudPaginated 返回完整分页对象', async () => {
    const paginated = { items: [{ id: '1' }], total: 1, page: 1, pageSize: 20 };
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCrudPaginated('things', 'things'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(paginated);
  });

  it('useCrudItem 有 id 时请求详情，无 id 时禁用查询', async () => {
    mockedApi.get.mockResolvedValue({ data: { id: '1' } });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCrudItem('things', 'things', '1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/things/1');

    vi.clearAllMocks();
    renderHook(() => useCrudItem('things', 'things', undefined), { wrapper });
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('useCrudCreate 成功时失效缓存，失败时调用 createError toast', async () => {
    mockedApi.post.mockRejectedValue(new Error('boom'));
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCrudCreate('things', 'things'), { wrapper });

    result.current.mutate({ name: 'x' });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedToast.createError).toHaveBeenCalledWith('things', expect.any(Error));
    expect(invalidate).not.toHaveBeenCalled();

    mockedApi.post.mockResolvedValue({ data: { id: '1' } });
    result.current.mutate({ name: 'y' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['things'] });
  });

  it('useCrudUpdate 失败时调用 updateError toast', async () => {
    mockedApi.patch.mockRejectedValue(new Error('boom'));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCrudUpdate('things', 'things'), { wrapper });

    result.current.mutate({ id: '1', data: { name: 'x' } });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedToast.updateError).toHaveBeenCalledWith('things', expect.any(Error));
  });

  it('useCrudDelete 失败时调用 deleteError toast', async () => {
    mockedApi.delete.mockRejectedValue(new Error('boom'));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCrudDelete('things', 'things'), { wrapper });

    result.current.mutate('1');
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedToast.deleteError).toHaveBeenCalledWith('things', expect.any(Error));
  });

  it('createCrudHooks 组装的 useList 返回数组', async () => {
    const hooks = createCrudHooks('gadgets', 'gadgets');
    mockedApi.get.mockResolvedValue({ data: { items: [{ id: 'g1' }], total: 1, page: 1, pageSize: 20 } });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => hooks.useList(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual([{ id: 'g1' }]);
  });

  it('createPaginatedCrudHooks 组装的 useList 返回分页对象', async () => {
    const hooks = createPaginatedCrudHooks('gadgets', 'gadgets');
    const paginated = { items: [{ id: 'g1' }], total: 1, page: 1, pageSize: 20 };
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => hooks.useList({ page: 1 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(paginated);
  });
});
