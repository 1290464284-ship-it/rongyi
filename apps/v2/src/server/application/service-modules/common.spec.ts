import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import {
  assertCanManageUser,
  assertChairExists,
  assertVisitExists,
  canManageUser,
  countBossUsersInClinic,
  generateDocumentNumber,
  hashRefreshToken,
  isUserRole,
  newRefreshToken,
  ROLE_MANAGEMENT_LEVEL,
  safeJsonObject,
  userBelongsToClinic,
} from './common';
import { UserRole } from '../../../domain/contracts';

describe('generateDocumentNumber', () => {  it('returns a document number in the shared format prefix-<base36 timestamp>-<8 hex chars>', () => {
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
    expect(ROLE_MANAGEMENT_LEVEL).toEqual({ BOSS: 3, ADMIN: 2, DOCTOR: 1 });
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

  it('asserts management hierarchy with a stable forbidden error', () => {
    expect(() => assertCanManageUser('ADMIN', 'BOSS')).toThrow('管理员不能管理老板账号');
    expect(() => assertCanManageUser('DOCTOR', 'DOCTOR')).toThrow('医生不能管理员工账号');
    expect(() => assertCanManageUser('BOSS', 'ADMIN')).not.toThrow();
    for (const attempt of [() => assertCanManageUser('ADMIN', 'BOSS'), () => assertCanManageUser('DOCTOR', 'DOCTOR')]) {
      try {
        attempt();
        throw new Error('expected assertion to throw');
      } catch (error) {
        expect((error as { code?: string }).code).toBe('FORBIDDEN');
      }
    }
  });
});

describe('auth and JSON helpers', () => {
  it('hashes refresh tokens deterministically', () => {
    const token = 'refresh-token-value';
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).toMatch(/^[0-9a-f]{64}$/);
    const first = newRefreshToken();
    const second = newRefreshToken();
    expect(first).toMatch(/^[0-9a-f]{96}$/);
    expect(second).toMatch(/^[0-9a-f]{96}$/);
    expect(first).not.toBe(second);
  });

  it('recognizes only the three supported user roles', () => {
    expect(isUserRole('BOSS')).toBe(true);
    expect(isUserRole('ADMIN')).toBe(true);
    expect(isUserRole('DOCTOR')).toBe(true);
    expect(isUserRole('RECEPTIONIST')).toBe(false);
  });

  it('parses objects defensively', () => {
    expect(safeJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(safeJsonObject('not-json')).toEqual({});
    expect(safeJsonObject('[1,2]')).toEqual({});
    expect(safeJsonObject(null)).toEqual({});
    expect(safeJsonObject('0')).toEqual({});
    expect(safeJsonObject('false')).toEqual({});
    expect(safeJsonObject('""')).toEqual({});
    expect(safeJsonObject('1')).toEqual({});
  });

  it('falls back for unknown management roles', () => {
    expect(canManageUser('BOSS' as UserRole, 'UNKNOWN' as UserRole)).toBe(true); // 3 >= 0
    expect(canManageUser('UNKNOWN' as UserRole, 'BOSS' as UserRole)).toBe(false); // 0 >= 3
  });

  it('treats a missing clinic id as global scope', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE User (id TEXT PRIMARY KEY, role TEXT, active INTEGER, deletedAt TEXT, clinicId TEXT)');
    expect(userBelongsToClinic(db, 'u1', null)).toBe(true);
    expect(userBelongsToClinic(db, 'u1', undefined)).toBe(true);
    expect(countBossUsersInClinic(db, null)).toBe(0);
    db.close();
  });

  it('validates chair and visit id inputs', () => {
    const db = new Database(':memory:');
    db.exec('CREATE TABLE Chair (id TEXT PRIMARY KEY, active INTEGER, deletedAt TEXT, clinicId TEXT)');
    db.exec('CREATE TABLE Visit (id TEXT PRIMARY KEY, patientId TEXT, deletedAt TEXT, clinicId TEXT)');
    expect(() => assertChairExists(db, '', 'clinic-v2-001')).toThrow('chairId is required');
    expect(() => assertChairExists(db, 42 as unknown as string, 'clinic-v2-001')).toThrow('chairId is required');
    expect(() => assertVisitExists(db, '', 'p1', 'clinic-v2-001')).toThrow('visitId is required');
    expect(() => assertVisitExists(db, 'v1', '', 'clinic-v2-001')).toThrow('patientId is required');
    db.close();
  });

});
