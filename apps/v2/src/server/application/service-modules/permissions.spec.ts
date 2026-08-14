import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  beforeEach(() => {
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

  afterEach(() => {
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

  it('ignores legacy UserRole rows whose role is not in the default permission table', () => {
    db.prepare(
      `INSERT INTO UserRole (userId, role, clinicId, createdAt, updatedAt, deletedAt)
       VALUES ('perm-user-001', 'GHOST-LEGACY-ROLE', 'clinic-v2-001', ?, ?, NULL)`,
    ).run(now, now);
    // 未知角色跳过（hasOwnProperty else 分支），结果与无附加角色时一致
    expect(computeEffectivePermissions(db, 'perm-user-001', 'clinic-v2-001', 'DOCTOR')).toEqual([
      'dashboard',
      'patients',
      'clinical',
      'communication',
    ]);
  });

  it('rejects non-boolean allowed values in user permission updates', () => {
    const service = new UserPermissionService(db);
    expect(() => service.setPermissions('perm-user-001', [
      { permission: 'finance', allowed: 'yes' as never },
    ], context)).toThrow('allowed must be a boolean');
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
    db.prepare(
      `INSERT INTO RolePermission (id, role, resource, permission, allowed, clinicId, createdAt, updatedAt, deletedAt)
       VALUES ('role-finance-fixture', 'DOCTOR', 'finance', 'access', 1, 'clinic-v2-001', ?, ?, NULL)`,
    ).run(now, now);
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

  it('rejects malformed, duplicate, and missing permission keys', () => {
    const service = new UserPermissionService(db);
    expect(() => service.setPermissions('perm-user-001', null as unknown as [], context))
      .toThrow('permissions must be an array');
    expect(() => service.setPermissions('perm-user-001', [null as never], context))
      .toThrow('permissions must be an array');
    expect(() => service.setPermissions('perm-user-001', [{ allowed: true } as never], context))
      .toThrow('Invalid permission key: ');
    expect(() => service.setPermissions('perm-user-001', [
      { permission: 'finance', allowed: true },
      { permission: 'finance', allowed: false },
    ], context)).toThrow('Duplicate permission key: finance');

    const roleService = new RoleModulePermissionService(db);
    expect(() => roleService.setForRole('DOCTOR', null as unknown as [], context))
      .toThrow('permissions must be an array');
    expect(() => roleService.setForRole('DOCTOR', [{ allowed: true } as never], context))
      .toThrow('Invalid permission key: ');
    expect(() => roleService.setForRole('DOCTOR', [
      { resource: 'finance', allowed: true },
      { resource: 'finance', allowed: false },
    ], context)).toThrow('Duplicate permission key: finance');
  });

  it('normalizes all canonical false representations', () => {
    const service = new UserPermissionService(db);
    const result = service.setPermissions('perm-user-001', [
      { permission: 'finance', allowed: 0 as unknown as boolean },
      { permission: 'analytics', allowed: '0' as unknown as boolean },
      { permission: 'hr', allowed: 'false' as unknown as boolean },
    ], context);
    expect(result.items.map((row) => ({ permission: row.permission, allowed: row.allowed })).sort(
      (a, b) => a.permission.localeCompare(b.permission),
    )).toEqual([
      { permission: 'analytics', allowed: 0 },
      { permission: 'finance', allowed: 0 },
      { permission: 'hr', allowed: 0 },
    ]);
  });

  it('rejects permission updates without a clinic id instead of failing on NOT NULL', () => {
    const service = new UserPermissionService(db);
    expect(() => service.setPermissions(
      'perm-user-001',
      [{ permission: 'finance', allowed: true }],
      { ...context, clinicId: null },
    )).toThrow('clinicId is required for permission updates');
    const roleService = new RoleModulePermissionService(db);
    expect(() => roleService.setForRole(
      'DOCTOR',
      [{ resource: 'finance', allowed: true }],
      { ...context, clinicId: null },
    )).toThrow('clinicId is required for permission updates');
  });

  it('ignores unknown role permission resources and user permission keys', () => {
    db.prepare(
      `INSERT INTO RolePermission (id, role, resource, permission, allowed, clinicId, createdAt, updatedAt, deletedAt)
       VALUES ('role-bogus-1', 'DOCTOR', 'not-a-module', 'access', 1, 'clinic-v2-001', ?, ?, NULL)`,
    ).run(now, now);
    db.prepare(
      `INSERT INTO UserPermission (userId, permission, allowed, clinicId, createdAt, updatedAt, deletedAt)
       VALUES ('perm-user-001', 'not-a-module', 1, 'clinic-v2-001', ?, ?, NULL)`,
    ).run(now, now);
    expect(computeEffectivePermissions(db, 'perm-user-001', 'clinic-v2-001', 'DOCTOR'))
      .toEqual(['dashboard', 'patients', 'clinical', 'communication']);

    const roleService = new RoleModulePermissionService(db);
    const listed = roleService.listForRole('DOCTOR', context);
    expect(listed.items).toEqual([{ resource: 'not-a-module', allowed: true }]);
    expect(listed.effective).not.toContain('not-a-module');
  });
});
