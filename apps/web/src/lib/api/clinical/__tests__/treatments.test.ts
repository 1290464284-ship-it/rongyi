import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { createQueryWrapper } from '@/test/query-test-utils';
import {
  useTreatments,
  useUpdateTreatment,
  TREATMENT_STATUS_LABEL,
} from '@/lib/api/clinical/treatments';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe('clinical/treatments hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useTreatments 请求 /treatments 并携带牙位与 pageSize=200', async () => {
    const paginated = { items: [{ id: 't1' }], total: 1, page: 1, pageSize: 200 };
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useTreatments('p1', 11), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/treatments', {
      params: { patientId: 'p1', toothNumber: 11, pageSize: 200 },
    });
    expect(result.current.data).toEqual(paginated);
  });

  it('useTreatments enabled=false 时不发请求', () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useTreatments('p1', undefined, { enabled: false }), { wrapper });
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('useUpdateTreatment 提交 PATCH /treatments/:id 并失效缓存', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 't1', status: 'COMPLETED' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateTreatment(), { wrapper });

    result.current.mutate({ id: 't1', data: { status: 'COMPLETED', remark: '完成' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/treatments/t1', {
      status: 'COMPLETED',
      remark: '完成',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['treatments'] });
  });

  it('状态标签映射完整', () => {
    expect(Object.keys(TREATMENT_STATUS_LABEL)).toHaveLength(5);
    expect(TREATMENT_STATUS_LABEL.PLANNED).toBe('计划');
  });
});
