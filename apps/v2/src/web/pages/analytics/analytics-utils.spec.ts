import { describe, expect, it } from 'vitest';
import { csvCell, daysAgo, maxValue, today } from './analytics-utils';

describe('analytics-utils', () => {
  it('formats csv cells with nulls, objects and formula injection guards', () => {
    expect(csvCell(null)).toBe('');
    expect(csvCell(undefined)).toBe('');
    expect(csvCell({ a: 1 })).toBe('"{\"\"a\"\":1}"');
    expect(csvCell('=SUM(A1)')).toBe('"\'=SUM(A1)"');
    expect(csvCell('a"b')).toBe('"a""b"');
  });

  it('clamps maxValue to at least one and formats dates', () => {
    expect(maxValue([], () => 0)).toBe(1);
    expect(maxValue([{ amount: 5 }], (row) => Number(row.amount))).toBe(5);
    expect(maxValue([{ amount: 0 }], (row) => Number(row.amount))).toBe(1);
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(daysAgo(0)).toBe(today());
  });
});
