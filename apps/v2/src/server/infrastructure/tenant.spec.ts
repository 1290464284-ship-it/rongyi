import { describe, expect, it } from 'vitest';
import { tenantAnd, tenantMatches, tenantParams, tenantWhere } from './tenant';

describe('tenant helpers', () => {
  it('builds scoped and unscoped filters', () => {
    expect(tenantWhere('clinic-1')).toEqual({ sql: '(clinicId = ? OR clinicId IS NULL)', params: ['clinic-1'] });
    expect(tenantWhere(null)).toEqual({ sql: '', params: [] });
    expect(tenantParams('clinic-1')).toEqual(['clinic-1']);
    expect(tenantAnd('clinic-1')).toBe(' AND (clinicId = ? OR clinicId IS NULL)');
    expect(tenantAnd(null)).toBe('');
  });

  it('matches legacy null rows and rejects rows from another clinic', () => {
    expect(tenantMatches(null, 'clinic-1')).toBe(true);
    expect(tenantMatches('clinic-2', 'clinic-1')).toBe(false);
    expect(tenantMatches('clinic-2', null)).toBe(true);
  });
});
