import { describe, expect, it } from 'vitest';
import { extractFailedFiles } from './lib/flaky-parse.mjs';

describe('extractFailedFiles', () => {
  it('extracts files from default reporter failure lines', () => {
    const output = [
      ' ❯ src/server/http/routes/foo.spec.ts (2 tests | 1 failed) 8ms',
      '   × foo > bar 4ms',
      ' ❯ src/web/pages/x.spec.tsx (1 test | 1 failed) 2ms',
      '   × x > renders 1ms',
    ].join('\n');
    expect(extractFailedFiles(output)).toEqual([
      'src/server/http/routes/foo.spec.ts',
      'src/web/pages/x.spec.tsx',
    ]);
  });

  it('extracts and dedupes FAIL lines', () => {
    const output = ['FAIL  src/a.spec.ts', ' FAIL  src/a.spec.ts', 'FAIL src/b.spec.ts'].join('\n');
    expect(extractFailedFiles(output)).toEqual(['src/a.spec.ts', 'src/b.spec.ts']);
  });

  it('returns [] for passing output', () => {
    expect(extractFailedFiles('Test Files 304 passed (304)\n Tests 3310 passed (3310)')).toEqual([]);
  });

  it('ignores non-spec file mentions', () => {
    expect(extractFailedFiles(' ❯ src/server/main.ts (0 tests)')).toEqual([]);
  });

  it('tolerates non-string input', () => {
    expect(extractFailedFiles(null)).toEqual([]);
  });
});
