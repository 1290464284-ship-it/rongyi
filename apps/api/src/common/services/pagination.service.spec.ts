import { PaginationService } from './pagination.service';
import { BusinessValidationException } from '@common/errors';
import { ForbiddenException } from '@nestjs/common';
import { PAGINATION, MAX_PAGE_SIZE } from '../constants/pagination';

describe('PaginationService', () => {
  let service: PaginationService;

  beforeEach(() => {
    service = new PaginationService();
  });

  describe('validatePagination', () => {
    it('默认值应返回 page=1, pageSize=DEFAULT_PAGE_SIZE', () => {
      const result = service.validatePagination(undefined, undefined);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(PAGINATION.DEFAULT_PAGE_SIZE);
    });

    it('正常值应原样返回', () => {
      const result = service.validatePagination(2, 20);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(20);
    });

    it('page < 1 应修正为 1', () => {
      const result = service.validatePagination(0, 20);
      expect(result.page).toBe(1);
    });

    it('负数 page 应修正为 1', () => {
      const result = service.validatePagination(-5, 20);
      expect(result.page).toBe(1);
    });

    it('pageSize > MAX_PAGE_SIZE 应截断为 MAX_PAGE_SIZE', () => {
      const result = service.validatePagination(1, 9999);
      expect(result.pageSize).toBe(MAX_PAGE_SIZE);
    });

    it('pageSize = 0 应使用默认值（0 为 falsy）', () => {
      const result = service.validatePagination(1, 0);
      expect(result.pageSize).toBe(PAGINATION.DEFAULT_PAGE_SIZE);
    });

    it('浮点数应向下取整', () => {
      const result = service.validatePagination(2.7, 15.9);
      expect(result.page).toBe(2);
      expect(result.pageSize).toBe(15);
    });

    it('NaN 值应使用默认值', () => {
      const result = service.validatePagination(NaN, NaN);
      expect(result.page).toBe(1);
      expect(result.pageSize).toBe(PAGINATION.DEFAULT_PAGE_SIZE);
    });
  });

  describe('validateSort', () => {
    it('合法字段名和 ASC 应返回正确结果', () => {
      const result = service.validateSort('createdAt', 'asc');
      expect(result.sortBy).toBe('createdAt');
      expect(result.sortOrder).toBe('ASC');
    });

    it('DESC 应大写返回', () => {
      const result = service.validateSort('name', 'DESC');
      expect(result.sortOrder).toBe('DESC');
    });

    it('无效排序方向应默认为 DESC', () => {
      const result = service.validateSort('name', 'invalid');
      expect(result.sortOrder).toBe('DESC');
    });

    it('无效字段名应抛出 BusinessValidationException', () => {
      expect(() => service.validateSort('invalid; DROP TABLE', 'ASC'))
        .toThrow(BusinessValidationException);
    });
  });

  describe('buildWhereClause', () => {
    const baseOptions = {
      searchFields: ['name', 'phone'],
      skipClinicFilter: false,
      hasSoftDelete: true,
      includeDeleted: false,
    };

    it('应添加 clinicId 过滤', () => {
      const result = service.buildWhereClause({ ...baseOptions, clinicId: 'clinic-1' });
      expect(result.whereClause).toContain('clinicId = ?');
      expect(result.params).toContain('clinic-1');
    });

    it('无 clinicId 且 skipClinicFilter=false 应抛出 ForbiddenException', () => {
      expect(() => service.buildWhereClause({ ...baseOptions, clinicId: undefined }))
        .toThrow(ForbiddenException);
    });

    it('skipClinicFilter=true 时不需要 clinicId', () => {
      const result = service.buildWhereClause({ ...baseOptions, skipClinicFilter: true });
      expect(result.whereClause).not.toContain('clinicId');
    });

    it('hasSoftDelete=true 且 includeDeleted=false 应添加 deletedAt IS NULL', () => {
      const result = service.buildWhereClause({ ...baseOptions, clinicId: 'c1' });
      expect(result.whereClause).toContain('deletedAt IS NULL');
    });

    it('includeDeleted=true 不添加 deletedAt 过滤', () => {
      const result = service.buildWhereClause({ ...baseOptions, clinicId: 'c1', includeDeleted: true });
      expect(result.whereClause).not.toContain('deletedAt');
    });

    it('有关键字时应生成 LIKE 条件', () => {
      const result = service.buildWhereClause({
        ...baseOptions, clinicId: 'c1', keyword: '张',
      });
      expect(result.whereClause).toContain('name LIKE ?');
      expect(result.whereClause).toContain('phone LIKE ?');
      expect(result.params.filter(p => typeof p === 'string' && p.includes('%')).length).toBe(2);
    });

    it('无关键字时不生成 LIKE 条件', () => {
      const result = service.buildWhereClause({ ...baseOptions, clinicId: 'c1' });
      expect(result.whereClause).not.toContain('LIKE');
    });

    it('filters 应生成等值条件', () => {
      const result = service.buildWhereClause({
        ...baseOptions, clinicId: 'c1', filters: { status: 'active' },
      });
      expect(result.whereClause).toContain('status = ?');
      expect(result.params).toContain('active');
    });

    it('filters 中无效字段名应抛出异常', () => {
      expect(() => service.buildWhereClause({
        ...baseOptions, clinicId: 'c1', filters: { 'bad;field': 'value' },
      })).toThrow(BusinessValidationException);
    });

    it('allowedFilterFields 限制外的字段应抛出异常', () => {
      expect(() => service.buildWhereClause({
        ...baseOptions, clinicId: 'c1',
        filters: { status: 'active' },
        allowedFilterFields: new Set(['name']),
      })).toThrow(BusinessValidationException);
    });

    it('空值 filter 不应添加条件', () => {
      const result = service.buildWhereClause({
        ...baseOptions, clinicId: 'c1', filters: { status: '' },
      });
      expect(result.whereClause).not.toContain('status');
    });

    it('无条件时 whereClause 应为空字符串', () => {
      const result = service.buildWhereClause({
        searchFields: [], skipClinicFilter: true, hasSoftDelete: false, includeDeleted: false,
      });
      expect(result.whereClause).toBe('');
    });
  });
});

