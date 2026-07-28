import type { ReactNode } from 'react';
import type { UserRole } from '@dental/shared';
import { usePermission } from '@/lib/hooks/use-permission';

type Role = UserRole;

/**
 * 检查当前用户是否拥有指定角色之一的权限级别
 *
 * 使用层级制判断：传入 ['DOCTOR'] 则 BOSS 和 DOCTOR 均通过（BOSS 级别更高）。
 * 传入多个角色时，取其中最低级别作为门槛（即最宽松的权限要求）。
 */
export function useHasRole(roles: Role[]): boolean {
  const { hasPermission } = usePermission();
  // 取列表中最低级别角色作为门槛——级别越低要求越宽松
  return roles.some((role) => hasPermission(role));
}

/** 检查当前用户是否是老板 */
export function useIsBoss(): boolean {
  const { isBoss } = usePermission();
  return isBoss;
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
