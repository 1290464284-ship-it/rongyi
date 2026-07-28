import { describe, it, expect, vi, beforeEach } from 'vitest';
import { queryClient } from '@/lib/api/query-client';
import { useAuthStore } from '@/lib/store/auth-store';

vi.mock('@/lib/api/query-client', () => ({
  queryClient: { clear: vi.fn() },
}));

const mockedQueryClient = vi.mocked(queryClient);

const bossUser = {
  id: 'u1',
  username: 'boss',
  name: '老板',
  role: 'BOSS' as const,
};

describe('useAuthStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAuthStore.setState({ user: null });
    localStorage.clear();
  });

  it('初始状态未登录', () => {
    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated()).toBe(false);
  });

  it('login 写入用户并视为已认证', () => {
    useAuthStore.getState().login(bossUser);

    const state = useAuthStore.getState();
    expect(state.user).toEqual(bossUser);
    expect(state.isAuthenticated()).toBe(true);
  });

  it('logout 清空用户并清空 React Query 缓存', () => {
    useAuthStore.getState().login(bossUser);
    useAuthStore.getState().logout();

    const state = useAuthStore.getState();
    expect(state.user).toBeNull();
    expect(state.isAuthenticated()).toBe(false);
    expect(mockedQueryClient.clear).toHaveBeenCalledTimes(1);
  });

  it('persist 只持久化 user 字段到 auth-storage', () => {
    useAuthStore.getState().login(bossUser);

    const raw = localStorage.getItem('auth-storage');
    expect(raw).not.toBeNull();
    const persisted = JSON.parse(raw as string) as { state: Record<string, unknown> };
    expect(persisted.state).toEqual({ user: bossUser });
  });
});
