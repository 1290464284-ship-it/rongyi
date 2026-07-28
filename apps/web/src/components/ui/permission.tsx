import type { ReactNode } from 'react';
import type { UserRole } from '@dental/shared';
import { useAuthStore } from '@/lib/store/auth-store';

type Role = UserRole;

/** 检查当前用户是否拥有指定角色之一 */
export function useHasRole(roles: Role[]): boolean {
  const user = useAuthStore((s) => s.user);
  return !!user && roles.includes(user.role);
}

/** 检查当前用户是否是老板 */
export function useIsBoss(): boolean {
  return useHasRole(['BOSS']);
}

interface PermissionButtonProps {
  roles: Role[];
  children: ReactNode;
  fallback?: ReactNode;
}

/** 权限按钮包装器：无权限时不渲染（或渲染 fallback） */
export function PermissionButton({ roles, children, fallback = null }: PermissionButtonProps) {
  const allowed = useHasRole(roles);
  if (!allowed) return <>{fallback}</>;
  return <>{children}</>;
}
