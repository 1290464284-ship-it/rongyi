import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { api, resetRefreshFailedFlag } from '@/lib/api/api';
import { createQueryWrapper } from '@/__tests__/query-test-utils';
import { useLogin, useChangePassword } from '@/lib/auth';

vi.mock('@/lib/api/api', () => ({
  api: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() },
  resetRefreshFailedFlag: vi.fn(),
}));

const mockedApi = vi.mocked(api);
const mockedReset = vi.mocked(resetRefreshFailedFlag);

describe('auth hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('useLogin 提交登录并重置 refresh 失败标志', async () => {
    const user = { id: 'u1', username: 'boss', name: '老板', role: 'BOSS' };
    mockedApi.post.mockResolvedValue({ data: { user } });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useLogin(), { wrapper });

    result.current.mutate({ username: 'boss', password: 'secret' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/login', {
      username: 'boss',
      password: 'secret',
    });
    expect(mockedReset).toHaveBeenCalledTimes(1);
    expect(result.current.data).toEqual({ user });
  });

  it('useLogin 登录失败时不重置 refresh 失败标志', async () => {
    mockedApi.post.mockRejectedValue(new Error('bad credentials'));
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useLogin(), { wrapper });

    result.current.mutate({ username: 'boss', password: 'wrong' });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(mockedReset).not.toHaveBeenCalled();
  });

  it('useChangePassword 提交修改密码请求', async () => {
    mockedApi.post.mockResolvedValue({ data: undefined });
    const { wrapper } = createQueryWrapper();
    const { result } = renderHook(() => useChangePassword(), { wrapper });

    result.current.mutate({ oldPassword: 'old', newPassword: 'new' });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mockedApi.post).toHaveBeenCalledWith('/auth/change-password', {
      oldPassword: 'old',
      newPassword: 'new',
    });
  });
});
