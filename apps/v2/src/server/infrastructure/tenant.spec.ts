import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { tenantAnd, tenantMatches, tenantParams, tenantWhere } from './tenant';

describe('tenant helpers', () => {
  it('builds scoped and unscoped filters', () => {
    expect(tenantWhere('clinic-1')).toEqual({ sql: '(clinicId = ?)', params: ['clinic-1'] });
    expect(tenantWhere('clinic-1').sql).not.toContain('IS NULL');
    expect(tenantWhere(null)).toEqual({ sql: '', params: [] });
    expect(tenantWhere(undefined)).toEqual({ sql: '', params: [] });
    expect(tenantParams('clinic-1')).toEqual(['clinic-1']);
    expect(tenantAnd('clinic-1')).toBe(' AND (clinicId = ?)');
    expect(tenantAnd(null)).toBe('');
  });

  it('strictly matches the row clinic and rejects null rows when scoped', () => {
    expect(tenantMatches(null, 'clinic-1')).toBe(false);
    expect(tenantMatches(undefined, 'clinic-1')).toBe(false);
    expect(tenantMatches('clinic-1', 'clinic-1')).toBe(true);
    expect(tenantMatches('clinic-2', 'clinic-1')).toBe(false);
    expect(tenantMatches('clinic-2', null)).toBe(true);
  });

  it('matches arbitrary non-null clinic ids only when equal', () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.integer(), fc.constant(null), fc.constant(undefined)),
        fc.string({ minLength: 1 }),
        (rowClinicId, clinicId) => {
          const expected = Boolean(clinicId)
            && rowClinicId !== null
            && rowClinicId !== undefined
            && String(rowClinicId) === clinicId;
          expect(tenantMatches(rowClinicId, clinicId)).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
