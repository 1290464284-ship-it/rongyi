/**
 * 分页常量（前后端共享）
 *
 * 统一管理分页相关常量，作为唯一来源。
 * API 层通过 common/constants/pagination.ts 重导出保持向后兼容。
 */
export const MAX_PAGE_SIZE = 200;

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  DEFAULT_PAGE_SIZE_MEDIUM: 50,
  DEFAULT_PAGE_SIZE_LARGE: 100,
  DEFAULT_PAGE_SIZE_XLARGE: 500,
  MAX_PAGE_SIZE,
} as const;
