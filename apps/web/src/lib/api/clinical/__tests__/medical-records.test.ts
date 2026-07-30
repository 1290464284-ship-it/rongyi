import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { createQueryWrapper } from '@/__tests__/query-test-utils';
import {
  useMedicalRecords,
  useLockMedicalRecord,
  useRecordTemplates,
  useCreateRecordTemplate,
  useRecordPhrases,
  useCreateRecordPhrase,
  useRecordModifyRequests,
  useCreateModifyRequest,
  useReviewModifyRequest,
} from '@/lib/api/clinical/medical-records';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe('clinical/medical-records hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useMedicalRecords 请求 /medical-records 并返回分页对象', async () => {
    const paginated = { items: [{ id: 'mr1' }], total: 1, page: 1, pageSize: 20 };
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const params = { patientId: 'p1', page: 1 };
    const { result } = renderHook(() => useMedicalRecords(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/medical-records', expect.objectContaining({ params }));
    expect(result.current.data).toEqual(paginated);
  });

  it('useLockMedicalRecord 提交 POST /medical-records/:id/lock', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'mr1', isLocked: 1 } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useLockMedicalRecord(), { wrapper });

    result.current.mutate('mr1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/medical-records/mr1/lock');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['medical-records'] });
  });

  it('useRecordTemplates 用 URLSearchParams 拼接查询串', async () => {
    const res = { items: [{ id: 'tpl1' }], total: 1 };
    mockedApi.get.mockResolvedValue({ data: res });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useRecordTemplates({ category: 'exam', page: 1, pageSize: 10 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/medical-records/templates?category=exam&page=1&pageSize=10', expect.any(Object));
    expect(result.current.data).toEqual(res);
  });

  it('useRecordTemplates 无参数时查询串为空', async () => {
    mockedApi.get.mockResolvedValue({ data: { items: [], total: 0 } });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRecordTemplates(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/medical-records/templates?', expect.any(Object));
  });

  it('useCreateRecordTemplate 提交 POST /medical-records/templates', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'tpl1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateRecordTemplate(), { wrapper });

    const dto = { name: '拔牙模板', content: '常规拔牙' };
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/medical-records/templates', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['record-templates'] });
  });

  it('useRecordPhrases 请求 /medical-records/phrases 并携带 category', async () => {
    const res = { items: [{ id: 'ph1' }], total: 1 };
    mockedApi.get.mockResolvedValue({ data: res });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useRecordPhrases({ category: 'common' }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/medical-records/phrases?category=common', expect.any(Object));
    expect(result.current.data).toEqual(res);
  });

  it('useCreateRecordPhrase 提交 POST /medical-records/phrases', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'ph1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateRecordPhrase(), { wrapper });

    const dto = { content: '牙龈红肿' };
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/medical-records/phrases', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['record-phrases'] });
  });

  it('useRecordModifyRequests 请求 /medical-records/modify-requests 并携带 status', async () => {
    const res = { items: [{ id: 'req1' }], total: 1 };
    mockedApi.get.mockResolvedValue({ data: res });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useRecordModifyRequests({ status: 'PENDING', page: 2 }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/medical-records/modify-requests?status=PENDING&page=2', expect.any(Object));
    expect(result.current.data).toEqual(res);
  });

  it('useCreateModifyRequest 提交 POST /medical-records/modify-requests', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'req1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateModifyRequest(), { wrapper });

    const dto = { recordId: 'mr1', reason: '诊断补充' };
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/medical-records/modify-requests', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['record-modify-requests'] });
  });

  it('useReviewModifyRequest 提交 PATCH /medical-records/modify-requests/:id/review', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'req1', status: 'APPROVED' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useReviewModifyRequest(), { wrapper });

    result.current.mutate({ id: 'req1', data: { status: 'APPROVED', remark: '同意' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/medical-records/modify-requests/req1/review', {
      status: 'APPROVED',
      remark: '同意',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['record-modify-requests'] });
  });
});
