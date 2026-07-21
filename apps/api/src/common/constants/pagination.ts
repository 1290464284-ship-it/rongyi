/**
 * 分页常量
 *
 * P2 修复（MAX_PAGE_SIZE 在三处定义且值不一致 200/100/100）：
 * 统一引用 dto/pagination.ts 的 MAX_PAGE_SIZE 作为唯一来源（值=200）。
 * 第三处 utils/common.ts 已作为死代码删除。
 */
import { MAX_PAGE_SIZE } from '../dto/pagination.dto';

export const PAGINATION = {
  DEFAULT_PAGE: 1,
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE,
} as const;
