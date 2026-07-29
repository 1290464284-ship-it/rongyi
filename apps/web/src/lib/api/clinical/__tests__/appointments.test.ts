import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { createQueryWrapper } from '@/__tests__/query-test-utils';
import {
  useAppointments,
  useCreateAppointment,
  useUpdateAppointment,
  useDeleteAppointment,
  APPOINTMENT_STATUS_LABEL,
  APPOINTMENT_TYPE_LABEL,
} from '@/lib/api/clinical/appointments';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe('clinical/appointments hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useAppointments 请求 /appointments 并强制 pageSize=200', async () => {
    const paginated = { items: [{ id: 'a1' }], total: 1, page: 1, pageSize: 200 };
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(
      () => useAppointments({ doctorId: 'd1', startDate: '2026-07-01', endDate: '2026-07-31' }),
      { wrapper }
    );

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/appointments', {
      params: { doctorId: 'd1', startDate: '2026-07-01', endDate: '2026-07-31', pageSize: 200 },
    });
    expect(result.current.data).toEqual(paginated);
  });

  it('useAppointments enabled=false 时不发请求', () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useAppointments({ doctorId: 'd1' }, { enabled: false }), { wrapper });
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('useCreateAppointment 提交 POST /appointments 并失效缓存', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'a1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateAppointment(), { wrapper });

    const dto = {
      patientId: 'p1',
      doctorId: 'd1',
      startTime: '2026-07-28T09:00:00Z',
      endTime: '2026-07-28T09:30:00Z',
      type: 'FIRST_VISIT' as const,
    };
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/appointments', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['appointments'] });
  });

  it('useUpdateAppointment 提交 PATCH /appointments/:id', async () => {
    mockedApi.patch.mockResolvedValue({ data: { id: 'a1', status: 'ARRIVED' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useUpdateAppointment(), { wrapper });

    result.current.mutate({ id: 'a1', data: { status: 'ARRIVED' } });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.patch).toHaveBeenCalledWith('/appointments/a1', { status: 'ARRIVED' });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['appointments'] });
  });

  it('useDeleteAppointment 提交 DELETE /appointments/:id', async () => {
    mockedApi.delete.mockResolvedValue({});
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDeleteAppointment(), { wrapper });

    result.current.mutate('a1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.delete).toHaveBeenCalledWith('/appointments/a1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['appointments'] });
  });

  it('状态/类型标签映射覆盖所有枚举值', () => {
    expect(APPOINTMENT_STATUS_LABEL.BOOKED).toBe('已预约');
    expect(APPOINTMENT_STATUS_LABEL.NO_SHOW).toBe('爽约');
    expect(APPOINTMENT_TYPE_LABEL.FIRST_VISIT).toBe('初诊');
    expect(Object.keys(APPOINTMENT_STATUS_LABEL)).toHaveLength(6);
    expect(Object.keys(APPOINTMENT_TYPE_LABEL)).toHaveLength(6);
  });
});
