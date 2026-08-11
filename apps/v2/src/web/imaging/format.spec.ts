// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { categoryName, formatDateTime, imagingOptionLabel, phaseLabel, toLocalDatetime } from './format';

describe('imaging/format', () => {
  it('formats dates and datetimes defensively', () => {
    expect(formatDateTime(null)).toBe('');
    expect(formatDateTime(undefined)).toBe('');
    expect(formatDateTime('2026-08-10T10:30:00.000Z')).toContain('2026');
    expect(toLocalDatetime('2026-08-10T10:30:00')).toBe('2026-08-10T10:30');
    expect(toLocalDatetime('not-a-date')).toBe('');
    expect(toLocalDatetime(null)).toBe('');
  });

  it('maps phase and category labels', () => {
    expect(phaseLabel('INITIAL')).toBe('初诊');
    expect(phaseLabel('UNKNOWN_PHASE')).toBe('UNKNOWN_PHASE');
    expect(phaseLabel(null)).toBe('');
    expect(categoryName({ id: 'i-1', categoryId: 'cat-1' }, [{ id: 'cat-1', name: '全景' }])).toBe('全景');
    expect(categoryName({ id: 'i-1', categoryId: 'cat-2' }, [{ id: 'cat-1', name: '全景' }])).toBe('cat-2');
    expect(categoryName({ id: 'i-1', categoryId: null }, [])).toBe('');
  });

  it('builds imaging option labels with and without timestamps', () => {
    expect(imagingOptionLabel({ id: 'i-1', title: '初诊片', takenAt: null })).toBe('初诊片');
    expect(imagingOptionLabel({ id: 'i-2', title: null, takenAt: '2026-08-10T10:30:00.000Z' })).toContain('i-2');
  });
});
