import { describe, expect, it } from 'vitest';
import { isSubpathStub } from './lib/license-classify.mjs';

describe('license-scan package classification', () => {
  it('keeps scoped packages and rejects subpath stubs', () => {
    expect(isSubpathStub('@types/node')).toBe(false);
    expect(isSubpathStub('@tanstack/react-query')).toBe(false);
    expect(isSubpathStub('rxjs')).toBe(false);
    expect(isSubpathStub('rxjs/ajax')).toBe(true);
    expect(isSubpathStub('@scope/pkg/subpath')).toBe(true);
  });
});
