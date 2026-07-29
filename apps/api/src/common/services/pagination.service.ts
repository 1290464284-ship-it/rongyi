import { Injectable, ForbiddenException } from '@nestjs/common';
import { BusinessValidationException } from '@common/errors';
import { MAX_PAGE_SIZE, PAGINATION } from '../constants/pagination';
import { validateColumnName, escapeLike } from '../utils/db/validate-name';

export interface PaginationWhereResult {
  conditions: string[];
  params: unknown[];
  whereClause: string;
}

export interface BuildWhereOptions {
  keyword?: string;
  searchFields: string[];
  filters?: Record<string, unknown>;
  allowedFilterFields?: Set<string>;
  clinicId?: string;
  skipClinicFilter: boolean;
  hasSoftDelete: boolean;
  includeDeleted: boolean;
}

export interface ValidatedPagination {
  page: number;
  pageSize: number;
}

export interface ValidatedSort {
  sortBy: string;
  sortOrder: 'ASC' | 'DESC';
}

@Injectable()
export class PaginationService {
  validatePagination(
    rawPage: number | undefined,
    rawPageSize: number | undefined,
  ): ValidatedPagination {
    const page = Math.max(1, Math.floor(Number(rawPage) || 1));
    const pageSize = Math.min(
      Math.max(1, Math.floor(Number(rawPageSize) || PAGINATION.DEFAULT_PAGE_SIZE)),
      MAX_PAGE_SIZE,
    );
    return { page, pageSize };
  }

  validateSort(sortBy: string, sortOrder: string): ValidatedSort {
    if (!validateColumnName(sortBy)) {
      throw new BusinessValidationException(`无效的排序字段: ${sortBy}`);
    }
    const validSortOrder = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    return { sortBy, sortOrder: validSortOrder };
  }

  buildWhereClause(options: BuildWhereOptions): PaginationWhereResult {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (!options.skipClinicFilter) {
      const { clinicId } = options;
      if (clinicId) {
        conditions.push('clinicId = ?');
        params.push(clinicId);
      } else {
        throw new ForbiddenException('缺少诊所信息，请重新登录');
      }
    }

    if (options.hasSoftDelete && !options.includeDeleted) {
      conditions.push('deletedAt IS NULL');
    }

    if (options.keyword && options.searchFields.length > 0) {
      const escaped = escapeLike(options.keyword);
      const likeConditions = options.searchFields.map((f) => `${f} LIKE ? ESCAPE '\\'`);
      conditions.push(`(${likeConditions.join(' OR ')})`);
      params.push(...options.searchFields.map(() => `%${escaped}%`));
    }

    if (options.filters) {
      Object.entries(options.filters).forEach(([key, value]) => {
        if (!validateColumnName(key)) {
          throw new BusinessValidationException(`无效的过滤字段名: ${key}`);
        }
        if (options.allowedFilterFields && !options.allowedFilterFields.has(key)) {
          throw new BusinessValidationException(`无效的过滤字段: ${key}`);
        }
        if (value !== undefined && value !== null && value !== '') {
          conditions.push(`${key} = ?`);
          params.push(value);
        }
      });
    }

    const whereClause = conditions.length > 0 ? ` WHERE ${conditions.join(' AND ')}` : '';
    return { conditions, params, whereClause };
  }
}