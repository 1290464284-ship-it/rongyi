import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { createQueryWrapper } from '@/__tests__/query-test-utils';
import {
  useTreatmentPlans,
  useCreateTreatmentPlan,
  useUpdatePlanStatus,
  useUpdatePlanItemStatus,
  PLAN_STATUS_LABEL,
  ITEM_STATUS_LABEL,
} from '@/lib/api/clinical/treatment-plans';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe('clinical/treatment-plans hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useTreatmentPlans 请求 /treatment-plans', async () => {
    const paginated = { items: [{ id: 'tp1' }], total: 1, page: 1, pageSize: 20 };
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const params = { patientId: 'p1', status: 'DRAFT' as const };
    const { result } = renderHook(() => useTreatmentPlans(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/treatment-plans', expect.objectContaining({ params }));
    expect(result.current.data).toEqual(paginated);
  });

  it('useCreateTreatmentPlan 提交 POST /treatment-plans', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'tp1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateTreatmentPlan(), { wrapper });

    const dto = {
      patientId: 'p1',
      items: [{ treatmentCatalogId: 't1', treatmentCatalogName: '补牙', price: 300, quantity: 1 }],
    };
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/treatment-plans', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['treatment-plans'] });
  });

  it('useUpdatePlanStatus 提交 PATCH /treatment-plans/:id/status', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'tp1', status: 'APPROVED' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdatePlanStatus(), { wrapper });

    result.current.mutate({ id: 'tp1', status: 'APPROVED' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/treatment-plans/tp1/status', { status: 'APPROVED' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['treatment-plans'] });
  });

  it('useUpdatePlanItemStatus 提交 PATCH /treatment-plans/:id/items/:itemId/status', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'tp1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdatePlanItemStatus(), { wrapper });

    result.current.mutate({ id: 'tp1', itemId: 'i1', status: 'COMPLETED' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/treatment-plans/tp1/items/i1/status', {
      status: 'COMPLETED',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['treatment-plans'] });
  });

  it('状态标签映射完整', () => {
    expect(Object.keys(PLAN_STATUS_LABEL)).toHaveLength(7);
    expect(Object.keys(ITEM_STATUS_LABEL)).toHaveLength(4);
    expect(PLAN_STATUS_LABEL.DRAFT).toBe('草稿');
    expect(ITEM_STATUS_LABEL.SKIPPED).toBe('已跳过');
  });
});
