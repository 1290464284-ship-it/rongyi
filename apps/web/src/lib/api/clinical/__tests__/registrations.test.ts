import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { createQueryWrapper } from '@/__tests__/query-test-utils';
import {
  useRegistrations,
  useCreateRegistration,
  useTriageRegistration,
  useStartVisitRegistration,
  useCompleteRegistration,
  useCancelRegistration,
  REGISTRATION_STATUS_LABEL,
  REGISTRATION_TYPE_LABEL,
} from '@/lib/api/clinical/registrations';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe('clinical/registrations hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useRegistrations 请求 /registrations 并返回分页对象', async () => {
    const paginated = { items: [{ id: 'r1' }], total: 1, page: 1, pageSize: 20 };
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const params = { status: 'PENDING' as const, page: 1 };
    const { result } = renderHook(() => useRegistrations(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/registrations', { params });
    expect(result.current.data).toEqual(paginated);
  });

  it('useCreateRegistration 提交 POST /registrations', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'r1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateRegistration(), { wrapper });

    const dto = { patientId: 'p1', complaint: '牙痛' };
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/registrations', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['registrations'] });
  });

  it('useTriageRegistration 提交 PATCH /registrations/:id/triage', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'r1', status: 'TRIAGED' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useTriageRegistration(), { wrapper });

    result.current.mutate({ id: 'r1', data: { doctorId: 'd1', triageNote: '优先' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/registrations/r1/triage', {
      doctorId: 'd1',
      triageNote: '优先',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['registrations'] });
  });

  it('useStartVisitRegistration 提交 PATCH /registrations/:id/start-visit', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'r1', status: 'VISITING' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useStartVisitRegistration(), { wrapper });

    result.current.mutate('r1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/registrations/r1/start-visit');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['registrations'] });
  });

  it('useCompleteRegistration 提交 PATCH /registrations/:id/complete', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'r1', status: 'COMPLETED' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCompleteRegistration(), { wrapper });

    result.current.mutate('r1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/registrations/r1/complete');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['registrations'] });
  });

  it('useCancelRegistration 提交 PATCH /registrations/:id/cancel', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'r1', status: 'CANCELLED' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCancelRegistration(), { wrapper });

    result.current.mutate('r1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/registrations/r1/cancel');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['registrations'] });
  });

  it('状态/类型标签映射完整', () => {
    expect(Object.keys(REGISTRATION_STATUS_LABEL)).toHaveLength(7);
    expect(Object.keys(REGISTRATION_TYPE_LABEL)).toHaveLength(6);
    expect(REGISTRATION_STATUS_LABEL.PENDING).toBe('待分诊');
    expect(REGISTRATION_TYPE_LABEL.WALK_IN).toBe('门诊');
  });
});
