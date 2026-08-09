import { describe, expect, it } from 'vitest';
import { code39Bars, barcodeDimensions, sanitizeCode39 } from './barcode';

describe('Code39 barcode encoder', () => {
  it('sanitizes values to Code39 alphabet', () => {
    expect(sanitizeCode39('abc-123')).toBe('ABC-123');
    expect(sanitizeCode39('你好*AB')).toBe('AB');
  });

  it('produces non-empty bars and a positive canvas', () => {
    const bars = code39Bars('RONGYI-001');
    expect(bars.length).toBeGreaterThan(0);
    const { width, height } = barcodeDimensions(bars);
    expect(width).toBeGreaterThan(0);
    expect(height).toBe(56);
    for (const bar of bars) {
      expect(bar.width).toBeGreaterThan(0);
    }
  });
});
