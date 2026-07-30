import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { createQueryWrapper } from '@/__tests__/query-test-utils';
import {
  useFollowUpsV2,
  useCreateFollowUpV2,
  useCompleteFollowUpV2,
  useFollowUpTemplates,
  useToggleFollowUpTemplate,
  useFollowUpItems,
  useCreateFollowUpItem,
  useFollowUpAutoRules,
  useToggleFollowUpAutoRule,
  useFollowUpWorkloadStats,
  useFollowUpNpsStats,
  FOLLOW_UP_STATUS_LABEL,
  FOLLOW_UP_PRIORITY_LABEL,
} from '@/lib/api/communication/follow-ups';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe('communication/follow-ups hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useFollowUpsV2 请求 /follow-ups 并返回分页对象', async () => {
    const paginated = { items: [{ id: 'fu1' }], total: 1, page: 1, pageSize: 20 };
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const params = { status: 'PENDING' as const, page: 1 };
    const { result } = renderHook(() => useFollowUpsV2(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/follow-ups', expect.objectContaining({ params }));
    expect(result.current.data).toEqual(paginated);
  });

  it('useCreateFollowUpV2 提交 POST /follow-ups', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'fu1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateFollowUpV2(), { wrapper });

    const dto = { patientId: 'p1', type: 'CALL', content: '术后回访' };
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/follow-ups', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['follow-ups'] });
  });

  it('useCompleteFollowUpV2 提交 POST /follow-ups/:id/complete', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'fu1', status: 'COMPLETED' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCompleteFollowUpV2(), { wrapper });

    result.current.mutate({ id: 'fu1', data: { result: '恢复良好' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/follow-ups/fu1/complete', { result: '恢复良好' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['follow-ups'] });
  });

  it('useFollowUpTemplates 将数组响应包装为分页对象', async () => {
    const templates = [{ id: 'tpl1' }, { id: 'tpl2' }];
    mockedApi.get.mockResolvedValue({ data: templates });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFollowUpTemplates({ page: 2, pageSize: 5 }), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/follow-ups/templates/list', expect.objectContaining({
      params: { page: 2, pageSize: 5 },
    }));
    expect(result.current.data).toEqual({ items: templates, total: 2, page: 2, pageSize: 5 });
  });

  it('useToggleFollowUpTemplate 提交 POST /follow-ups/templates/:id/toggle', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'tpl1', isEnabled: false } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useToggleFollowUpTemplate(), { wrapper });

    result.current.mutate('tpl1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/follow-ups/templates/tpl1/toggle');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['follow-up-templates'] });
  });

  it('useFollowUpItems 将数组响应包装为分页对象（默认 page 1 / pageSize 10）', async () => {
    const items = [{ id: 'item1' }];
    mockedApi.get.mockResolvedValue({ data: items });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFollowUpItems(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/follow-ups/items/list', expect.objectContaining({ params: undefined }));
    expect(result.current.data).toEqual({ items, total: 1, page: 1, pageSize: 10 });
  });

  it('useCreateFollowUpItem 提交 POST /follow-ups/items', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'item1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateFollowUpItem(), { wrapper });

    const dto = { name: '满意度', type: 'RATING' };
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/follow-ups/items', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['follow-up-items'] });
  });

  it('useFollowUpAutoRules 请求 /follow-ups/auto-rules/list', async () => {
    const rules = [{ id: 'rule1' }];
    mockedApi.get.mockResolvedValue({ data: rules });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFollowUpAutoRules(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/follow-ups/auto-rules/list', expect.objectContaining({ params: undefined }));
    expect(result.current.data?.items).toEqual(rules);
  });

  it('useToggleFollowUpAutoRule 提交 POST /follow-ups/auto-rules/:id/toggle', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'rule1', isEnabled: true } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useToggleFollowUpAutoRule(), { wrapper });

    result.current.mutate('rule1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/follow-ups/auto-rules/rule1/toggle');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['follow-up-auto-rules'] });
  });

  it('useFollowUpWorkloadStats / useFollowUpNpsStats 请求统计端点', async () => {
    const workload = { total: 10, completed: 5, pending: 5, byStatus: {}, byType: {} };
    const nps = { score: 60, count: 20, trend: [] };
    mockedApi.get.mockResolvedValueOnce({ data: workload }).mockResolvedValueOnce({ data: nps });
    const { wrapper } = createQueryWrapper();
    const params = { startDate: '2026-07-01', endDate: '2026-07-28' };
    const { result: workloadResult } = renderHook(() => useFollowUpWorkloadStats(params), { wrapper });
    await waitFor(() => expect(workloadResult.current.isSuccess).toBe(true));

    const { result: npsResult } = renderHook(() => useFollowUpNpsStats(params), { wrapper });
    await waitFor(() => expect(npsResult.current.isSuccess).toBe(true));

    expect(mockedApi.get).toHaveBeenNthCalledWith(1, '/follow-ups/stats/workload', expect.objectContaining({ params }));
    expect(mockedApi.get).toHaveBeenNthCalledWith(2, '/follow-ups/stats/nps', expect.objectContaining({ params }));
    expect(workloadResult.current.data).toEqual(workload);
    expect(npsResult.current.data).toEqual(nps);
  });

  it('状态/优先级标签映射正确', () => {
    expect(FOLLOW_UP_STATUS_LABEL.PENDING).toBe('待处理');
    expect(FOLLOW_UP_PRIORITY_LABEL.URGENT).toBe('紧急');
  });
});
