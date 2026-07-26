/**
 * 权限检查 Hook
 *
 * 基于当前用户角色判断权限，替代组件内硬编码角色判断。
 * 使用 @dental/shared 的 ROLES / ROLE_LEVELS 统一权限层级。
 */
import { useCallback, useMemo } from 'react';
import { useAuthStore } from '../store/auth-store';
import { ROLES, ROLE_LEVELS, type SharedRole } from '@dental/shared';

/**
 * 权限检查 hook
 *
 * @example
 * const { hasPermission, isBoss, isDoctor, role } = usePermission();
 * if (hasPermission('DOCTOR')) { ... }
 */
export function usePermission() {
  const user = useAuthStore(state => state.user);
  const role = (user?.role ?? '') as SharedRole;

  const hasPermission = useCallback((requiredRole: SharedRole) => {
    if (!role || !requiredRole) return false;
    const userLevel = ROLE_LEVELS[role] ?? 0;
    const requiredLevel = ROLE_LEVELS[requiredRole] ?? 0;
    return userLevel >= requiredLevel;
  }, [role]);

  const isBoss = useMemo(() => role === ROLES.BOSS, [role]);
  const isDoctor = useMemo(() => role === ROLES.DOCTOR, [role]);
  const isReceptionist = useMemo(() => role === ROLES.RECEPTIONIST, [role]);
  const isAdmin = useMemo(() => role === ROLES.ADMIN, [role]);

  return {
    role,
    hasPermission,
    isBoss,
    isDoctor,
    isReceptionist,
    isAdmin,
  };
}
