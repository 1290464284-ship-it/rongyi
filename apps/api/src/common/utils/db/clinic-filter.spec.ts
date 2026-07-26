import { buildClinicFilter, buildClinicFilterOptional } from './clinic-filter';

describe('clinic-filter', () => {
  describe('buildClinicFilter', () => {
    it('有效的 clinicId 应返回过滤条件', () => {
      const result = buildClinicFilter('clinic-123');
      expect(result.clause).toBe(' AND clinicId = ?');
      expect(result.params).toEqual(['clinic-123']);
    });

    it('null 应抛出错误', () => {
      expect(() => buildClinicFilter(null)).toThrow('CLINIC_CONTEXT_MISSING');
    });

    it('undefined 应抛出错误', () => {
      const arg: string | undefined = undefined;
      expect(() => buildClinicFilter(arg)).toThrow('CLINIC_CONTEXT_MISSING');
    });

    it('空字符串应抛出错误', () => {
      expect(() => buildClinicFilter('')).toThrow('CLINIC_CONTEXT_MISSING');
    });

    it('错误信息应包含中文说明', () => {
      expect(() => buildClinicFilter(null)).toThrow('诊所上下文缺失');
    });

    it('应返回 ClinicFilter 接口结构', () => {
      const result = buildClinicFilter('clinic-1');
      expect(result).toHaveProperty('clause');
      expect(result).toHaveProperty('params');
      expect(typeof result.clause).toBe('string');
      expect(Array.isArray(result.params)).toBe(true);
    });
  });

  describe('buildClinicFilterOptional', () => {
    it('有效的 clinicId 应返回过滤条件', () => {
      const result = buildClinicFilterOptional('clinic-123');
      expect(result.clause).toBe(' AND clinicId = ?');
      expect(result.params).toEqual(['clinic-123']);
    });

    it('null 应返回空过滤', () => {
      const result = buildClinicFilterOptional(null);
      expect(result.clause).toBe('');
      expect(result.params).toEqual([]);
    });

    it('undefined 应返回空过滤', () => {
      const arg: string | undefined = undefined;
      const result = buildClinicFilterOptional(arg);
      expect(result.clause).toBe('');
      expect(result.params).toEqual([]);
    });

    it('空字符串应返回空过滤', () => {
      const result = buildClinicFilterOptional('');
      expect(result.clause).toBe('');
      expect(result.params).toEqual([]);
    });

    it('应返回 ClinicFilter 接口结构', () => {
      const result = buildClinicFilterOptional(null);
      expect(result).toHaveProperty('clause');
      expect(result).toHaveProperty('params');
    });
  });

  describe('两者对比', () => {
    it('有 clinicId 时两者行为一致', () => {
      const id = 'clinic-123';
      const required = buildClinicFilter(id);
      const optional = buildClinicFilterOptional(id);
      expect(required.clause).toBe(optional.clause);
      expect(required.params).toEqual(optional.params);
    });

    it('无 clinicId 时行为不同：required 抛错，optional 返回空', () => {
      expect(() => buildClinicFilter(null)).toThrow();
      expect(() => buildClinicFilterOptional(null)).not.toThrow();
      const result = buildClinicFilterOptional(null);
      expect(result.clause).toBe('');
      expect(result.params).toEqual([]);
    });
  });

  describe('SQL 拼接使用场景', () => {
    it('过滤子句可直接拼接到 SQL', () => {
      const filter = buildClinicFilter('clinic-1');
      const sql = `SELECT * FROM patients WHERE status = 'active'${filter.clause}`;
      expect(sql).toBe("SELECT * FROM patients WHERE status = 'active' AND clinicId = ?");
    });

    it('可选过滤为空时不影响 SQL', () => {
      const filter = buildClinicFilterOptional(null);
      const sql = `SELECT * FROM patients WHERE status = 'active'${filter.clause}`;
      expect(sql).toBe("SELECT * FROM patients WHERE status = 'active'");
    });

    it('params 可直接用于参数化查询', () => {
      const baseParams = ['active'];
      const filter = buildClinicFilter('clinic-1');
      const allParams = [...baseParams, ...filter.params];
      expect(allParams).toEqual(['active', 'clinic-1']);
    });
  });
});
