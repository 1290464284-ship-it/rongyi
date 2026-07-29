import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { createQueryWrapper } from '@/__tests__/query-test-utils';
import {
  useVisits,
  useVisitsList,
  useCreateVisit,
  useCompleteVisit,
  VISIT_STATUS_LABEL,
} from '@/lib/api/clinical/visits';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

const paginated = { items: [{ id: 'v1' }], total: 1, page: 1, pageSize: 50 };

describe('clinical/visits hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useVisits 请求 /visits 并强制 pageSize=200', async () => {
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useVisits('p1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/visits', {
      params: { patientId: 'p1', pageSize: 200 },
    });
  });

  it('useVisitsList 默认 pageSize=50 且可被参数覆盖', async () => {
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useVisitsList({ doctorId: 'd1', pageSize: 10 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/visits', {
      params: { doctorId: 'd1', pageSize: 10 },
    });
  });

  it('useCreateVisit 提交 POST /visits 并失效 visits/appointments/dashboard', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'v1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateVisit(), { wrapper });

    const dto = { patientId: 'p1', chiefComplaint: '牙痛' };
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/visits', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['visits'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['appointments'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
  });

  it('useCompleteVisit 提交 PATCH /visits/:id/complete 并失效三组缓存', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'v1', status: 'COMPLETED' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCompleteVisit(), { wrapper });

    result.current.mutate({ id: 'v1', data: { diagnosis: '龋齿' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/visits/v1/complete', { diagnosis: '龋齿' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['visits'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['appointments'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['dashboard'] });
  });

  it('状态标签映射完整', () => {
    expect(Object.keys(VISIT_STATUS_LABEL)).toHaveLength(3);
    expect(VISIT_STATUS_LABEL.IN_PROGRESS).toBe('就诊中');
  });
});
