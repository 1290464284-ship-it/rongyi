import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { createQueryWrapper } from '@/__tests__/query-test-utils';
import {
  useCharges,
  useCharge,
  useCreateCharge,
  usePayCharge,
  useRefundCharge,
} from '@/lib/api/financial/charge';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

const paginated = {
  items: [{ id: 'c1', status: 'PAID' }],
  total: 1,
  page: 1,
  pageSize: 20,
};

describe('financial/charges hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useCharges 请求 /charge-v2 并返回分页对象', async () => {
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const params = { patientId: 'p1', page: 1, pageSize: 20 };
    const { result } = renderHook(() => useCharges(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/charge-v2', expect.objectContaining({ params }));
    expect(result.current.data).toEqual(paginated);
  });

  it('useCharges 支持 enabled=false 时不发请求', () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useCharges({ patientId: 'p1' }, { enabled: false }), { wrapper });
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('useCharge 请求 /charge-v2/:id', async () => {
    mockedApi.get.mockResolvedValue({ data: { id: 'c1' } });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useCharge('c1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/charge-v2/c1', expect.any(Object));
    expect(result.current.data).toEqual({ id: 'c1' });
  });

  it('useCharge 无 id 时不发请求', () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useCharge(undefined), { wrapper });
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('useCreateCharge 提交 POST /charge-v2 并失效 charges 缓存', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'c1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateCharge(), { wrapper });

    const dto = { patientId: 'p1', items: [] } as never;
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/charge-v2', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['charges'] });
  });

  it('usePayCharge 提交 PATCH /charge-v2/:id/pay 并失效 charges 缓存', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'c1', status: 'PAID' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => usePayCharge(), { wrapper });

    result.current.mutate({ id: 'c1', amount: 100, payMethod: 'CASH' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/charge-v2/c1/pay', {
      amount: 100,
      payMethod: 'CASH',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['charges'] });
  });

  it('useRefundCharge 提交 POST /refunds 并失效 charges 缓存', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'r1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRefundCharge(), { wrapper });

    result.current.mutate({ id: 'c1', patientId: 'p1', amount: 50, reason: '误收' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/refunds', {
      chargeId: 'c1',
      patientId: 'p1',
      amount: 50,
      reason: '误收',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['charges'] });
  });
});
