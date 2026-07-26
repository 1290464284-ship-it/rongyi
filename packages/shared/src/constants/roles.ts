/**
 * 角色常量与权限层级（前后端共享）
 *
 * 角色层级数值越大权限越高，可用于权限判断：
 * 例如：userRoleLevel >= requiredRoleLevel
 */
export const ROLES = {
  BOSS: 'BOSS',
  DOCTOR: 'DOCTOR',
  RECEPTIONIST: 'RECEPTIONIST',
  NURSE: 'NURSE',
  ADMIN: 'ADMIN',
} as const;

export type SharedRole = typeof ROLES[keyof typeof ROLES];

export const ROLE_LEVELS: Record<SharedRole, number> = {
  [ROLES.BOSS]: 5,
  [ROLES.ADMIN]: 4,
  [ROLES.DOCTOR]: 3,
  [ROLES.NURSE]: 2,
  [ROLES.RECEPTIONIST]: 1,
} as const;

export function hasRoleLevel(userRole: SharedRole, requiredRole: SharedRole): boolean {
  return ROLE_LEVELS[userRole] >= ROLE_LEVELS[requiredRole];
}
