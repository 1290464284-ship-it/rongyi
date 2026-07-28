import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { createQueryWrapper } from '@/test/query-test-utils';
import {
  usePeriodontalRecords,
  useCreatePeriodontalRecord,
  useUpdatePeriodontalRecord,
  useDeletePeriodontalRecord,
} from '@/lib/api/clinical/periodontal-records';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe('clinical/periodontal-records hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('usePeriodontalRecords 请求 /periodontal-records 并返回 items 数组', async () => {
    const items = [{ id: 'pr1' }];
    mockedApi.get.mockResolvedValue({ data: { items, total: 1, page: 1, pageSize: 20 } });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => usePeriodontalRecords('p1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/periodontal-records', {
      params: { patientId: 'p1' },
    });
    expect(result.current.data).toEqual(items);
  });

  it('useCreatePeriodontalRecord 提交 POST /periodontal-records', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'pr1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreatePeriodontalRecord(), { wrapper });

    const dto = {
      patientId: 'p1',
      examDate: '2026-07-28',
      data: { teeth: { 11: { buccalMid: 3 } }, general: { mobility: 'I度' } },
    };
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/periodontal-records', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['periodontal-records'] });
  });

  it('useUpdatePeriodontalRecord 提交 PATCH /periodontal-records/:id', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'pr1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdatePeriodontalRecord(), { wrapper });

    result.current.mutate({ id: 'pr1', data: { remark: '复查' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/periodontal-records/pr1', { remark: '复查' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['periodontal-records'] });
  });

  it('useDeletePeriodontalRecord 提交 DELETE /periodontal-records/:id', async () => {
    mockedApi.delete.mockResolvedValue({});
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDeletePeriodontalRecord(), { wrapper });

    result.current.mutate('pr1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.delete).toHaveBeenCalledWith('/periodontal-records/pr1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['periodontal-records'] });
  });
});
