import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api } from '@/lib/api/api';
import { createQueryWrapper } from '@/__tests__/query-test-utils';
import {
  useWechatMessages,
  useBirthdayPatients,
  useAppointmentReminders,
  useSendWechat,
  useSendBatchWechat,
} from '@/lib/api/communication/wechat';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe('communication/wechat hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useWechatMessages 请求 /wechat 并返回 items 数组', async () => {
    const items = [{ id: 'msg1' }];
    mockedApi.get.mockResolvedValue({ data: { items, total: 1, page: 1, pageSize: 20 } });
    const { wrapper } = createQueryWrapper();
    const params = { status: 'SENT' };
    const { result } = renderHook(() => useWechatMessages(params), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/wechat', expect.objectContaining({ params }));
    expect(result.current.data).toEqual(items);
  });

  it('useBirthdayPatients 请求 /wechat/birthday-patients', async () => {
    const patients = [{ id: 'p1', name: '张三' }];
    mockedApi.get.mockResolvedValue({ data: patients });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useBirthdayPatients(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/wechat/birthday-patients', expect.any(Object));
    expect(result.current.data).toEqual(patients);
  });

  it('useAppointmentReminders 请求 /wechat/appointment-reminders', async () => {
    const reminders = [{ id: 'apt1', patientName: '李四' }];
    mockedApi.get.mockResolvedValue({ data: reminders });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useAppointmentReminders(), { wrapper });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.get).toHaveBeenCalledWith('/wechat/appointment-reminders', expect.any(Object));
    expect(result.current.data).toEqual(reminders);
  });

  it('useSendWechat 提交 POST /wechat/send 并失效消息缓存', async () => {
    mockedApi.post.mockResolvedValue({ data: { id: 'msg1', status: 'SENT' } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSendWechat(), { wrapper });

    const dto = { patientId: 'p1', content: '您好，明天记得复诊' };
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/wechat/send', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['wechat-messages'] });
  });

  it('useSendBatchWechat 提交 POST /wechat/send-batch', async () => {
    mockedApi.post.mockResolvedValue({ data: { sent: 2 } });
    const { wrapper, queryClient } = createQueryWrapper();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { result } = renderHook(() => useSendBatchWechat(), { wrapper });

    const dto = { patientIds: ['p1', 'p2'], content: '生日快乐' };
    result.current.mutate(dto);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/wechat/send-batch', dto);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['wechat-messages'] });
  });
});
