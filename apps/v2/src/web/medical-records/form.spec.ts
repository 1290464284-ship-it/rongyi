// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { listToText, textValue } from './form';

describe('medical-records/form', () => {
  it('converts unknown values to text', () => {
    expect(textValue('abc')).toBe('abc');
    expect(textValue(1)).toBe('');
    expect(textValue(null)).toBe('');
    expect(textValue(undefined)).toBe('');
  });

  it('joins arrays and falls back for non-array values', () => {
    expect(listToText(['a', 'b'])).toBe('a, b');
    expect(listToText('single')).toBe('single');
    expect(listToText(null)).toBe('');
    expect(listToText(12)).toBe('');
  });
});
