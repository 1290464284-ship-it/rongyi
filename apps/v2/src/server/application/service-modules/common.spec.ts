import { describe, expect, it } from 'vitest';
import { generateDocumentNumber } from './common';

describe('generateDocumentNumber', () => {
  it('returns a document number in the shared format prefix-<base36 timestamp>-<8 hex chars>', () => {
    const before = Date.now();
    const number = generateDocumentNumber('CHG');
    const after = Date.now();
    expect(number.startsWith('CHG-')).toBe(true);
    const parts = number.split('-');
    expect(parts).toHaveLength(3);
    const timestamp = Number.parseInt(parts[1], 36);
    expect(Number.isFinite(timestamp)).toBe(true);
    expect(timestamp).toBeGreaterThanOrEqual(Math.floor(before / 1));
    expect(timestamp).toBeLessThanOrEqual(Math.floor(after / 1) + 1);
    expect(parts[2]).toMatch(/^[0-9A-F]{8}$/);
  });

  it('preserves the caller-provided prefix verbatim', () => {
    expect(generateDocumentNumber('DSP')).toMatch(/^DSP-/);
    expect(generateDocumentNumber('PO')).toMatch(/^PO-/);
    expect(generateDocumentNumber('RTS')).toMatch(/^RTS-/);
  });

  it('uses an uppercase random suffix so numbers differ even within the same millisecond', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i += 1) {
      const number = generateDocumentNumber('CHG');
      expect(number).toBe(number.toUpperCase());
      expect(seen.has(number)).toBe(false);
      seen.add(number);
    }
  });
});
