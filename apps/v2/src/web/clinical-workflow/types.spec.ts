import { describe, expect, it } from 'vitest';
import { rowPatientName } from './types';

describe('rowPatientName', () => {
  it('falls back through patient name, label, id, and empty string', () => {
    expect(rowPatientName({ patientName: '甲' })).toBe('甲');
    expect(rowPatientName({ patientIdLabel: '乙' })).toBe('乙');
    expect(rowPatientName({ patientId: 'p-1' })).toBe('p-1');
    expect(rowPatientName({})).toBe('');
  });
});
