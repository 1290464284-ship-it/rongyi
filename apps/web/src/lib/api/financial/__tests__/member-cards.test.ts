import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { createQueryWrapper } from '@/test/query-test-utils';
import {
  useMemberCards,
  usePatientMemberCard,
  useCreateMemberCard,
  useRechargeMemberCard,
  useMemberCardLogs,
  useMemberPointLogs,
  useAddPoints,
  useDeductPoints,
} from '@/lib/api/financial/member-cards';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe('financial/member-cards hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useMemberCards 请求 /member-cards 并携带默认分页参数', async () => {
    const paginated = { items: [{ id: 'mc1' }], total: 1, page: 1, pageSize: 20 };
    mockedApi.get.mockResolvedValue({ data: paginated });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMemberCards(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/member-cards', {
      params: { page: 1, pageSize: 20 },
    });
    expect(result.current.data).toEqual(paginated);
  });

  it('usePatientMemberCard 请求 /member-cards/patient/:patientId', async () => {
    mockedApi.get.mockResolvedValue({ data: { id: 'mc1', patientId: 'p1' } });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => usePatientMemberCard('p1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/member-cards/patient/p1');
    expect(result.current.data).toEqual({ id: 'mc1', patientId: 'p1' });
  });

  it('usePatientMemberCard 无 patientId 时不发请求', () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => usePatientMemberCard(''), { wrapper });
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('useCreateMemberCard 提交 POST /member-cards/patient/:patientId 并失效缓存', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'mc1' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useCreateMemberCard(), { wrapper });

    result.current.mutate('p1');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/member-cards/patient/p1');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['member-cards'] });
  });

  it('useRechargeMemberCard 提交 POST /member-cards/:id/recharge 并失效缓存', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'mc1', balance: 500 } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useRechargeMemberCard(), { wrapper });

    result.current.mutate({ id: 'mc1', amount: 500, remark: '充值' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/member-cards/mc1/recharge', {
      amount: 500,
      remark: '充值',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['member-cards'] });
  });

  it('useMemberCardLogs 请求 /member-cards/:cardId/logs', async () => {
    const logs = [{ id: 'log1', type: 'RECHARGE' }];
    mockedApi.get.mockResolvedValue({ data: logs });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMemberCardLogs('mc1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/member-cards/mc1/logs');
    expect(result.current.data).toEqual(logs);
  });

  it('useMemberCardLogs 无 cardId 时不发请求', () => {
    const { wrapper } = createQueryWrapper();
    renderHook(() => useMemberCardLogs(''), { wrapper });
    expect(mockedApi.get).not.toHaveBeenCalled();
  });

  it('useMemberPointLogs 请求 /member-cards/:cardId/point-logs', async () => {
    const logs = [{ id: 'pl1', type: 'EARN' }];
    mockedApi.get.mockResolvedValue({ data: logs });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useMemberPointLogs('mc1'), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/member-cards/mc1/point-logs');
    expect(result.current.data).toEqual(logs);
  });

  it('useAddPoints 提交 POST /member-cards/:id/points 并失效缓存', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'mc1', points: 100 } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useAddPoints(), { wrapper });

    result.current.mutate({ id: 'mc1', points: 100, chargeId: 'c1', remark: '消费积分' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/member-cards/mc1/points', {
      points: 100,
      chargeId: 'c1',
      remark: '消费积分',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['member-cards'] });
  });

  it('useDeductPoints 提交 POST /member-cards/:id/points/deduct 并失效缓存', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'mc1', points: 50 } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useDeductPoints(), { wrapper });

    result.current.mutate({ id: 'mc1', points: 50, remark: '兑换' });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/member-cards/mc1/points/deduct', {
      points: 50,
      remark: '兑换',
    });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['member-cards'] });
  });
});
