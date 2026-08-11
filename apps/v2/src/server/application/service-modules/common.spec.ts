import { describe, expect, it } from 'vitest';
import { canManageUser, generateDocumentNumber, ROLE_MANAGEMENT_LEVEL } from './common';
import { UserRole } from '../../../domain/contracts';

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

describe('role management hierarchy', () => {
  it('defines a strict three-level hierarchy', () => {
    expect(ROLE_MANAGEMENT_LEVEL.BOSS).toBeGreaterThan(ROLE_MANAGEMENT_LEVEL.ADMIN);
    expect(ROLE_MANAGEMENT_LEVEL.ADMIN).toBeGreaterThan(ROLE_MANAGEMENT_LEVEL.DOCTOR);
  });

  it('allows same-level management for BOSS/ADMIN but never for DOCTOR', () => {
    for (const role of Object.values(UserRole)) {
      if (role === 'DOCTOR') {
        expect(canManageUser(role, role)).toBe(false);
      } else {
        expect(canManageUser(role, role)).toBe(true);
      }
    }
  });

  it('blocks lower tiers from managing higher tiers and ADMIN from managing BOSS', () => {
    expect(canManageUser('ADMIN', 'BOSS')).toBe(false);
    expect(canManageUser('DOCTOR', 'BOSS')).toBe(false);
    expect(canManageUser('DOCTOR', 'ADMIN')).toBe(false);
    expect(canManageUser('BOSS', 'ADMIN')).toBe(true);
    expect(canManageUser('ADMIN', 'DOCTOR')).toBe(true);
  });
});
