import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { parsePagination } from './pagination';

function request(query: Record<string, unknown>): Parameters<typeof parsePagination>[0] {
  return { query } as Parameters<typeof parsePagination>[0];
}

describe('parsePagination property-based', () => {
  it('returns the requested page and clamps pageSize to 200 for valid integers', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000 }),
        fc.integer({ min: 1, max: 1_000 }),
        (page, pageSize) => {
          const result = parsePagination(request({ page: String(page), pageSize: String(pageSize) }));
          expect(result.page).toBe(page);
          expect(result.pageSize).toBe(Math.min(200, pageSize));
        },
      ),
      { numRuns: 100 },
    );
  });

  it('rejects malformed page and pageSize values', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('0'),
          fc.constant('-1'),
          fc.constant('1.5'),
          fc.constant('NaN'),
          fc.constant('Infinity'),
        ),
        (page) => {
          expect(() => parsePagination(request({ page, pageSize: '1' }))).toThrow('page must be a positive integer');
        },
      ),
      { numRuns: 50 },
    );

    fc.assert(
      fc.property(
        fc.oneof(
          fc.constant('0'),
          fc.constant('-1'),
          fc.constant('1.5'),
          fc.constant('NaN'),
          fc.constant('Infinity'),
        ),
        (pageSize) => {
          expect(() => parsePagination(request({ page: '1', pageSize }))).toThrow(
            'pageSize must be an integer between 1 and 200',
          );
        },
      ),
      { numRuns: 50 },
    );
  });

  it('uses the configured default page size when pageSize is absent', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 200 }),
        (defaultPageSize) => {
          const result = parsePagination(request({ page: '1' }), { defaultPageSize });
          expect(result.pageSize).toBe(defaultPageSize);
        },
      ),
      { numRuns: 50 },
    );
  });

  it('rejects pages above the hard cap and treats blank or missing values as defaults', () => {
    expect(parsePagination(request({ page: '1000000', pageSize: '200' }))).toEqual({ page: 1_000_000, pageSize: 200 });
    expect(() => parsePagination(request({ page: '1000001', pageSize: '1' }))).toThrow('page must be <= 1000000');
    expect(parsePagination(request({ page: ' ', pageSize: ' ' }))).toEqual({ page: 1, pageSize: 20 });
    expect(parsePagination(request({ page: null, pageSize: null }))).toEqual({ page: 1, pageSize: 20 });
  });
});
