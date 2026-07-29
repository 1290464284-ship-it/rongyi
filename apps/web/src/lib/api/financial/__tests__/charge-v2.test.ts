import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { createQueryWrapper } from '@/__tests__/query-test-utils';
import {
  useChargeCombos,
  useCreateChargeCombo,
  useUpdateChargeCombo,
  useDeleteChargeCombo,
  usePaymentMethods,
  useTogglePaymentMethod,
  useDebts,
  useDebtStats,
  usePayDebt,
} from '@/lib/api/financial/charge-v2';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe('financial/charge-v2 hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useChargeCombos 请求 /charge-v2/combos 并返回分页对象', async () => {
    const paginated = { items: [{ id: 'combo1' }], total: 1, page: 1, pageSize: 20 };
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const params = { page: 1, pageSize: 20, keyword: '洁牙' };
    const { result } = renderHook(() => useChargeCombos(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/charge-v2/combos', { params });
    expect(result.current.data).toEqual(paginated);
  });

  it('useCreateChargeCombo 提交 POST /charge-v2/combos 并失效缓存', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'combo1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateChargeCombo(), { wrapper });

    const dto = { name: '洁牙套餐', price: 100 } as never;
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/charge-v2/combos', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['charge-combos'] });
  });

  it('useUpdateChargeCombo 提交 PATCH /charge-v2/combos/:id', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'combo1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateChargeCombo(), { wrapper });

    const data = { name: '新名称' } as never;
    result.current.mutate({ id: 'combo1', data });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/charge-v2/combos/combo1', data);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['charge-combos'] });
  });

  it('useDeleteChargeCombo 提交 DELETE /charge-v2/combos/:id', async () => {
    mockedApi.delete.mockResolvedValue({});
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteChargeCombo(), { wrapper });

    result.current.mutate('combo1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.delete).toHaveBeenCalledWith('/charge-v2/combos/combo1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['charge-combos'] });
  });

  it('usePaymentMethods 请求 /charge-v2/payment-methods 并返回 items 数组', async () => {
    const items = [{ id: 'pm1', name: '现金' }];
    mockedApi.get.mockResolvedValue({ data: { items, total: 1, page: 1, pageSize: 20 } });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => usePaymentMethods({ isEnabled: true }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/charge-v2/payment-methods', {
      params: { isEnabled: true },
    });
    expect(result.current.data).toEqual(items);
  });

  it('useTogglePaymentMethod 提交 PATCH toggle 并失效缓存', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'pm1', isEnabled: false } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useTogglePaymentMethod(), { wrapper });

    result.current.mutate('pm1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/charge-v2/payment-methods/pm1/toggle');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['payment-methods'] });
  });

  it('useDebts 请求 /charge-v2/debts 并返回分页对象', async () => {
    const paginated = { items: [{ id: 'd1' }], total: 1, page: 1, pageSize: 20 };
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const params = { patientId: 'p1', status: 'PENDING' };
    const { result } = renderHook(() => useDebts(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/charge-v2/debts', { params });
    expect(result.current.data).toEqual(paginated);
  });

  it('useDebtStats 请求 /charge-v2/debts/stats', async () => {
    const stats = { totalDebt: 1000, debtCount: 3 };
    mockedApi.get.mockResolvedValue({ data: stats });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useDebtStats(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/charge-v2/debts/stats');
    expect(result.current.data).toEqual(stats);
  });

  it('usePayDebt 提交 POST /charge-v2/debts/:id/pay 并失效 debts 与 debt-stats', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'd1', status: 'PAID' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => usePayDebt(), { wrapper });

    const data = { amount: 200, payMethod: 'CASH' } as never;
    result.current.mutate({ id: 'd1', data });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/charge-v2/debts/d1/pay', data);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['debts'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['debt-stats'] });
  });
});
