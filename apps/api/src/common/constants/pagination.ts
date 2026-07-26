/**
 * 分页常量
 *
 * 统一管理分页相关常量，作为唯一来源
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
