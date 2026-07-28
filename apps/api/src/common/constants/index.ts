/**
 * 常量模块统一导出
 *
 * 注意：角色常量（ROLES / ROLE_LEVELS / hasRoleLevel / SharedRole）
 * 统一来自 @dental/shared。本文件不再 re-export roles.ts，
 * 以保证前后端共享同一事实来源。
 */
export * from './table-names';
export * from './pagination';
export * from './cache-keys';
export * from './audit-log-types';
export * from './business-status';
