import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useAuthStore } from '@/lib/store/auth-store';
import { usePermission } from '@/lib/hooks/use-permission';

vi.mock('@/lib/store/auth-store', () => ({
  useAuthStore: vi.fn(),
}));

const mockedUseAuthStore = vi.mocked(useAuthStore);

type AuthSelector = (state: { user: { role: string } | null }) => unknown;

const setRole = (role: string | null) => {
  mockedUseAuthStore.mockImplementation(((selector: AuthSelector) =>
    selector({ user: role ? { role } : null })) as never);
};

describe('usePermission', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('BOSS 拥有最高权限并命中 isBoss', () => {
    setRole('BOSS');
    const { result } = renderHook(() => usePermission());

    expect(result.current.role).toBe('BOSS');
    expect(result.current.isBoss).toBe(true);
    expect(result.current.isDoctor).toBe(false);
    expect(result.current.hasPermission('ADMIN')).toBe(true);
    expect(result.current.hasPermission('RECEPTIONIST')).toBe(true);
  });

  it('RECEPTIONIST 无法访问 DOCTOR 级功能', () => {
    setRole('RECEPTIONIST');
    const { result } = renderHook(() => usePermission());

    expect(result.current.isReceptionist).toBe(true);
    expect(result.current.hasPermission('DOCTOR')).toBe(false);
    expect(result.current.hasPermission('RECEPTIONIST')).toBe(true);
  });

  it('DOCTOR 可访问同级但不可访问 ADMIN 级', () => {
    setRole('DOCTOR');
    const { result } = renderHook(() => usePermission());

    expect(result.current.isDoctor).toBe(true);
    expect(result.current.isAdmin).toBe(false);
    expect(result.current.hasPermission('DOCTOR')).toBe(true);
    expect(result.current.hasPermission('ADMIN')).toBe(false);
  });

  it('未登录（无 user）时所有权限检查返回 false', () => {
    setRole(null);
    const { result } = renderHook(() => usePermission());

    expect(result.current.role).toBe('');
    expect(result.current.hasPermission('RECEPTIONIST')).toBe(false);
    expect(result.current.isBoss).toBe(false);
  });
});
