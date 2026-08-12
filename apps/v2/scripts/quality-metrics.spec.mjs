import { describe, expect, it } from 'vitest';
import { mutationScore, openApiPathMetrics } from './lib/quality-metrics.mjs';

describe('mutationScore', () => {
  it('counts killed and timeout mutants as covered', () => {
    expect(
      mutationScore([
        { status: 'Killed' },
        { status: 'Timeout' },
        { status: 'Survived' },
        { status: 'NoCoverage' },
      ]),
    ).toEqual({ killed: 2, survived: 1, noCoverage: 1, score: 0.5 });
  });

  it('ignores compile/runtime/ignored statuses and returns null when no mutants ran', () => {
    expect(mutationScore([{ status: 'CompileError' }, { status: 'Ignored' }])).toEqual({
      killed: 0,
      survived: 0,
      noCoverage: 0,
      score: null,
    });
    expect(mutationScore(null)).toEqual({ killed: 0, survived: 0, noCoverage: 0, score: null });
  });
});

describe('openApiPathMetrics', () => {
  it('returns zeroed metrics for empty inputs and full coverage', () => {
    expect(openApiPathMetrics()).toEqual({
      corePaths: 0,
      generatedPaths: 0,
      documentedPaths: 0,
      routeEntries: 0,
      uniqueRoutes: 0,
      uniqueRoutePaths: 0,
      routePathCoverage: 1,
    });
  });

  it('merges core and generated paths and normalizes the /api/v2 prefix', () => {
    const metrics = openApiPathMetrics({
      coreDoc: { paths: { '/health': {} } },
      generatedDoc: { paths: { '/files/:name': {} } },
      routeEntries: [
        { method: 'GET', path: '/api/v2/health' },
        { method: 'GET', path: '/api/v2/files/:name' },
      ],
    });
    expect(metrics).toMatchObject({
      corePaths: 1,
      generatedPaths: 1,
      documentedPaths: 2,
      routeEntries: 2,
      uniqueRoutes: 2,
      uniqueRoutePaths: 2,
      routePathCoverage: 1,
    });
  });

  it('deduplicates repeated method/path registrations', () => {
    const metrics = openApiPathMetrics({
      coreDoc: { paths: {} },
      generatedDoc: { paths: { '/files/:name': {}, '/files/:name/sign': {} } },
      routeEntries: [
        { method: 'GET', path: '/api/v2/files/:name' },
        { method: 'GET', path: '/api/v2/files/:name' },
        { method: 'GET', path: '/api/v2/files/:name/sign' },
      ],
    });
    expect(metrics.routeEntries).toBe(3);
    expect(metrics.uniqueRoutes).toBe(2);
    expect(metrics.uniqueRoutePaths).toBe(2);
    expect(metrics.routePathCoverage).toBe(1);
  });

  it('reports a partial coverage ratio when a route path is undocumented', () => {
    const metrics = openApiPathMetrics({
      coreDoc: { paths: { '/health': {} } },
      generatedDoc: { paths: {} },
      routeEntries: [
        { method: 'GET', path: '/api/v2/health' },
        { method: 'GET', path: '/api/v2/files/:name' },
      ],
    });
    expect(metrics.uniqueRoutePaths).toBe(2);
    expect(metrics.routePathCoverage).toBe(0.5);
  });
});
