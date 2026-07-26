/**
 * 角色常量和角色层级
 *
 * 角色层级数值越大权限越高，可用于权限判断：
 * 例如：userRoleLevel >= requiredRoleLevel
 */
export const ROLES = {
  BOSS: 'BOSS',
  DOCTOR: 'DOCTOR',
  RECEPTIONIST: 'RECEPTIONIST',
} as const;

export type Role = typeof ROLES[keyof typeof ROLES];

export const ROLE_LEVELS: Record<Role, number> = {
  [ROLES.BOSS]: 3,
  [ROLES.DOCTOR]: 2,
  [ROLES.RECEPTIONIST]: 1,
} as const;

export function hasRoleLevel(userRole: Role, requiredRole: Role): boolean {
  return ROLE_LEVELS[userRole] >= ROLE_LEVELS[requiredRole];
}
