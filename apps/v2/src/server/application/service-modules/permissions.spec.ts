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
  RoleModulePermissionService,
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
    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, phone, active, loginAttempts, tokenVersion
       ) VALUES ('perm-user-002', 'clinic-v2-001', ?, ?, NULL, 'permuser2', 'x', 'Perm User 2', 'DOCTOR', NULL, 1, 0, 0)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, phone, active, loginAttempts, tokenVersion
       ) VALUES ('perm-user-boss', 'clinic-v2-001', ?, ?, NULL, 'permboss', 'x', 'Perm Boss', 'BOSS', NULL, 1, 0, 0)`,
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

  it('blocks ADMIN from editing BOSS permissions', () => {
    const adminContext = { ...context, role: 'ADMIN' as const };
    const userService = new UserPermissionService(db);
    expect(() => userService.setPermissions('perm-user-boss', [
      { permission: 'system', allowed: false },
    ], adminContext)).toThrow('管理员不能修改老板的权限');
    const roleService = new RoleModulePermissionService(db);
    expect(() => roleService.setForRole('BOSS', [
      { resource: 'system', allowed: false },
    ], adminContext)).toThrow('管理员不能修改老板角色的权限');
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

  it('stores per-clinic user permission overrides independently', () => {
    const secondClinic = 'clinic-v2-002';
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'C2', 'Second Clinic', 1)`,
    ).run(secondClinic, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES (?, ?, 'DOCTOR', ?, ?, NULL)`,
    ).run('perm-user-002', secondClinic, now, now);

    const service = new UserPermissionService(db);
    service.setPermissions(
      'perm-user-002',
      [{ permission: 'analytics', allowed: true }],
      { ...context, clinicId: secondClinic },
    );

    const firstClinic = computeEffectivePermissions(db, 'perm-user-002', 'clinic-v2-001', 'DOCTOR');
    const second = computeEffectivePermissions(db, 'perm-user-002', secondClinic, 'DOCTOR');
    expect(firstClinic).not.toContain('analytics');
    expect(second).toContain('analytics');
    const rows = db.prepare(
      `SELECT clinicId FROM UserPermission
       WHERE userId = ? AND permission = 'analytics' AND deletedAt IS NULL`,
    ).all('perm-user-002') as Array<{ clinicId: string }>;
    expect(rows).toHaveLength(1);
    expect(rows[0].clinicId).toBe(secondClinic);
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

  it('applies role-level module overrides to every user of that role', () => {
    const roleService = new RoleModulePermissionService(db);
    roleService.setForRole('DOCTOR', [
      { resource: 'finance', allowed: true },
      { resource: 'patients', allowed: false },
    ], context);

    const effective = computeEffectivePermissions(db, 'perm-user-002', 'clinic-v2-001', 'DOCTOR');
    expect(effective).toContain('finance');
    expect(effective).not.toContain('patients');
    expect(effective).toContain('clinical');

    const listed = roleService.listForRole('DOCTOR', context);
    expect(listed.items).toEqual([
      { resource: 'finance', allowed: true },
      { resource: 'patients', allowed: false },
    ]);
  });
});
