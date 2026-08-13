import { describe, expect, it } from 'vitest';
import { coverageStats, mutationScore, openApiPathMetrics } from './lib/quality-metrics.mjs';

describe('coverageStats', () => {
  it('counts statements, branch paths, functions, and statement-derived lines', () => {
    const stats = coverageStats({
      'file-a.js': {
        statementMap: {
          '0': { start: { line: 1, column: 0 }, end: { line: 1, column: 4 } },
          '1': { start: { line: 2, column: 0 }, end: { line: 2, column: 4 } },
          '2': { start: { line: 1, column: 5 }, end: { line: 1, column: 9 } },
        },
        s: { '0': 1, '1': 0, '2': 0 },
        fnMap: { '0': { name: 'fn', decl: {}, loc: {} } },
        f: { '0': 1 },
        branchMap: { '0': { type: 'if', locations: [] } },
        b: { '0': [1, 0] },
      },
    });
    expect(stats).toEqual({
      statements: 1 / 3,
      branches: 0.5,
      functions: 1,
      lines: 0.5,
    });
  });

  it('returns null for empty input so callers fail instead of reporting 100%', () => {
    expect(coverageStats({})).toBeNull();
    expect(coverageStats(null)).toBeNull();
  });
});

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
  it('returns null route coverage for empty inputs so callers fail instead of reporting 100%', () => {
    expect(openApiPathMetrics()).toEqual({
      corePaths: 0,
      generatedPaths: 0,
      documentedPaths: 0,
      routeEntries: 0,
      uniqueRoutes: 0,
      uniqueRoutePaths: 0,
      routePathCoverage: null,
    });
  });

  it('merges core and generated paths and normalizes the /api/v2 prefix', () => {
    const metrics = openApiPathMetrics({
      coreDoc: { paths: { '/health': {} } },
      generatedDoc: { paths: { '/files/{name}': {} } },
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
      generatedDoc: { paths: { '/files/{name}': {}, '/files/{name}/sign': {} } },
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
