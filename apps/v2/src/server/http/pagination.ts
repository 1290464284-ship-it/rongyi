import type { Request } from 'express';
import { ValidationError } from '../infrastructure/errors';

export interface ParsedPagination {
  page: number;
  pageSize: number;
}

const MAX_PAGE_SIZE = 200;

/**
 * 统一分页解析：page 必须为正整数；pageSize 必须为 >=1 的整数，
 * 非法输入（NaN、小数、<1）抛 ValidationError（400），
 * 合法但超过 200 的 pageSize 自动封顶为 200。
 * 所有列表路由共用同一口径，避免多套解析边界漂移。
 */
export function parsePagination(req: Request): ParsedPagination {
  const rawPage = req.query.page ?? 1;
  const rawPageSize = req.query.pageSize ?? 20;
  const page = typeof rawPage === 'string' && rawPage.trim() !== '' ? Number(rawPage) : 1;
  const pageSize = typeof rawPageSize === 'string' && rawPageSize.trim() !== '' ? Number(rawPageSize) : 20;
  if (!Number.isInteger(page) || page < 1) throw new ValidationError('page must be a positive integer');
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new ValidationError(`pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}`);
  }
  return { page, pageSize: Math.min(MAX_PAGE_SIZE, pageSize) };
}
