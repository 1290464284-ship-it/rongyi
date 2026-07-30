import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { createQueryWrapper } from '@/__tests__/query-test-utils';
import {
  useOralExaminations,
  useCreateOralExamination,
  useUpdateOralExamination,
  useDeleteOralExamination,
} from '@/lib/api/clinical/oral-examinations';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe('clinical/oral-examinations hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useOralExaminations 请求 /oral-examinations 并返回 items 数组', async () => {
    const items = [{ id: 'oe1' }];
    mockedApi.get.mockResolvedValue({ data: { items, total: 1, page: 1, pageSize: 20 } });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useOralExaminations('p1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/oral-examinations', expect.objectContaining({
      params: { patientId: 'p1' },
    }));
    expect(result.current.data).toEqual(items);
  });

  it('useCreateOralExamination 提交 POST /oral-examinations', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'oe1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateOralExamination(), { wrapper });

    const dto = { patientId: 'p1', examDate: '2026-07-28', caries: ['16', '26'] };
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/oral-examinations', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['oral-examinations'] });
  });

  it('useUpdateOralExamination 提交 PATCH /oral-examinations/:id', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'oe1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateOralExamination(), { wrapper });

    result.current.mutate({ id: 'oe1', data: { mucosa: '正常' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/oral-examinations/oe1', { mucosa: '正常' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['oral-examinations'] });
  });

  it('useDeleteOralExamination 提交 DELETE /oral-examinations/:id', async () => {
    mockedApi.delete.mockResolvedValue({});
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteOralExamination(), { wrapper });

    result.current.mutate('oe1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.delete).toHaveBeenCalledWith('/oral-examinations/oe1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['oral-examinations'] });
  });
});
