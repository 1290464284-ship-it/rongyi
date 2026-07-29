import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { createQueryWrapper } from '@/__tests__/query-test-utils';
import {
  useFirstExams,
  useCompleteFirstExam,
  useRestartFirstExam,
  useFirstExamTeeth,
  useUpdateFirstExamTeeth,
  useUpdateTooth,
  useFirstExamTracks,
  useUpdateFirstExamTrack,
  useCreateFollowUp,
  useFirstExamStats,
  DENTITION_TYPE_LABEL,
  TOOTH_STATUS_LABEL,
} from '@/lib/api/clinical/first-exams';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe('clinical/first-exams hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useFirstExams 请求 /first-exams 并返回分页对象', async () => {
    const paginated = { items: [{ id: 'fe1' }], total: 1, page: 1, pageSize: 20 };
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const params = { patientId: 'p1', status: 'DRAFT' };
    const { result } = renderHook(() => useFirstExams(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/first-exams', { params });
    expect(result.current.data).toEqual(paginated);
  });

  it('useCompleteFirstExam 提交 PATCH /first-exams/:id/complete', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'fe1', status: 'APPROVED' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCompleteFirstExam(), { wrapper });

    result.current.mutate('fe1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/first-exams/fe1/complete');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['first-exams'] });
  });

  it('useRestartFirstExam 提交 PATCH /first-exams/:id/restart', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'fe1', status: 'DRAFT' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRestartFirstExam(), { wrapper });

    result.current.mutate('fe1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/first-exams/fe1/restart');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['first-exams'] });
  });

  it('useFirstExamTeeth 将 teeth 映射转换为数组并解析牙位号', async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        examId: 'fe1',
        teeth: {
          '11': { condition: '龋坏', status: 'CARIES' },
          '21': { status: 'NORMAL' },
        },
      },
    });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFirstExamTeeth('fe1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/first-exams/fe1/teeth');
    expect(result.current.data).toEqual([
      { toothNumber: 11, condition: '龋坏', status: 'CARIES' },
      { toothNumber: 21, status: 'NORMAL' },
    ]);
  });

  it('useFirstExamTeeth 无 examId 时不发请求', () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useFirstExamTeeth(undefined), { wrapper });
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('useUpdateFirstExamTeeth 提交 PATCH /first-exams/:examId/teeth', async () => {
    mockedApi.patch.mockResolvedValue({ data: { examId: 'fe1', teeth: {} } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateFirstExamTeeth(), { wrapper });

    const data = { examId: 'fe1', teeth: { '11': { status: 'CARIES' } } };
    result.current.mutate({ examId: 'fe1', data });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/first-exams/fe1/teeth', data);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['first-exam-teeth'] });
  });

  it('useUpdateTooth 提交 PATCH /first-exams/:examId/teeth/:toothNumber', async () => {
    mockedApi.patch.mockResolvedValue({ data: { examId: 'fe1', teeth: {} } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateTooth(), { wrapper });

    result.current.mutate({ examId: 'fe1', toothNumber: '11', data: { status: 'RESTORED' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/first-exams/fe1/teeth/11', { status: 'RESTORED' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['first-exam-teeth'] });
  });

  it('useFirstExamTracks 请求 /first-exams/tracks/list', async () => {
    const res = { items: [{ id: 'tr1' }], total: 1, page: 1, pageSize: 20 };
    mockedApi.get.mockResolvedValue({ data: res });
    const { wrapper } = createQueryWrapper();
    const params = { examId: 'fe1', page: 1 };
    const { result } = renderHook(() => useFirstExamTracks(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/first-exams/tracks/list', { params });
    expect(result.current.data).toEqual(res);
  });

  it('useUpdateFirstExamTrack 提交 PATCH /first-exams/tracks/:trackId', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'tr1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateFirstExamTrack(), { wrapper });

    result.current.mutate({ examId: 'fe1', trackId: 'tr1', data: { content: '更新' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/first-exams/tracks/tr1', { content: '更新' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['first-exam-tracks'] });
  });

  it('useCreateFollowUp 提交 POST /follow-ups 并失效 follow-ups 缓存', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'fu1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateFollowUp(), { wrapper });

    const dto = { patientId: 'p1', type: 'PHONE', content: '术后回访', followUpDate: '2026-08-01' };
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/follow-ups', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['follow-ups'] });
  });

  it('useFirstExamStats 请求 /first-exams/stats', async () => {
    const stats = { total: 10, pending: 2, inProgress: 3, completed: 5 };
    mockedApi.get.mockResolvedValue({ data: stats });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useFirstExamStats(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/first-exams/stats');
    expect(result.current.data).toEqual(stats);
  });

  it('牙列/牙位状态标签映射正确', () => {
    expect(DENTITION_TYPE_LABEL.PERMANENT).toBe('恒牙');
    expect(TOOTH_STATUS_LABEL.CARIES).toBe('龋齿');
  });
});
