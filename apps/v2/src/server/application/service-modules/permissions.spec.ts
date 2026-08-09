import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { AppError } from '../../infrastructure/errors';
import {
  PERMISSION_KEYS,
  UserPermissionService,
  computeEffectivePermissions,
} from './permissions';

describe('user module permissions', () => {
  let db: Database.Database;
  let dataDir: string;
  const now = '2026-08-09T10:00:00.000Z';
  const context = {
    userId: 'user-admin-001',
    clinicId: 'clinic-v2-001',
    role: 'BOSS' as const,
    traceId: 'test-trace',
    now: () => new Date(now),
  };

  beforeAll(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-user-permissions-spec-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, phone, active, loginAttempts, tokenVersion
       ) VALUES ('perm-user-001', 'clinic-v2-001', ?, ?, NULL, 'permuser', 'x', 'Perm User', 'DOCTOR', NULL, 1, 0, 0)`,
    ).run(now, now);
  });

  afterAll(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it('computes DOCTOR defaults and applies additional roles', () => {
    expect(computeEffectivePermissions(db, 'perm-user-001', 'clinic-v2-001', 'DOCTOR')).toEqual([
      'dashboard',
      'patients',
      'clinical',
      'communication',
    ]);

    db.prepare(
      `INSERT INTO UserRole (userId, role, clinicId, createdAt, updatedAt, deletedAt)
       VALUES ('perm-user-001', 'BOSS', 'clinic-v2-001', ?, ?, NULL)`,
    ).run(now, now);
    expect(computeEffectivePermissions(db, 'perm-user-001', 'clinic-v2-001', 'DOCTOR')).toEqual(PERMISSION_KEYS);
  });

  it('applies per-user overrides on top of role defaults', () => {
    const service = new UserPermissionService(db);
    service.setPermissions('perm-user-001', [
      { permission: 'finance', allowed: true },
      { permission: 'patients', allowed: false },
    ], context);

    const effective = computeEffectivePermissions(db, 'perm-user-001', 'clinic-v2-001', 'DOCTOR');
    expect(effective).toContain('finance');
    expect(effective).not.toContain('patients');
    expect(effective).toContain('clinical');
  });

  it('replaces the whole override set on PUT semantics', () => {
    const service = new UserPermissionService(db);
    const result = service.setPermissions('perm-user-001', [
      { permission: 'inventory', allowed: true },
    ], context);
    expect(result.items.map((row) => row.permission)).toEqual(['inventory']);
    expect(result.effective).toContain('inventory');
    expect(result.effective).toContain('finance');
  });

  it('rejects invalid permission keys and unknown users', () => {
    const service = new UserPermissionService(db);
    try {
      service.setPermissions('perm-user-001', [{ permission: 'not-a-module', allowed: true }], context);
      throw new Error('expected validation error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(400);
    }
    try {
      service.setPermissions('missing-user-001', [], context);
      throw new Error('expected not found error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).status).toBe(404);
    }
  });
});
