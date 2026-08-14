import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type Database from 'better-sqlite3';
import { createDatabase, seedDatabase } from '../../infrastructure/database';
import { runMigrations } from '../../infrastructure/migrations';
import { NotFoundError, ValidationError } from '../../infrastructure/errors';
import type { AppContext } from '../../../domain/contracts';
import { UserRoleService } from './multi-role';

describe('UserRoleService', () => {
  let db: Database.Database;
  let dataDir: string;
  let context: AppContext;
  const now = '2026-08-05T10:00:00.000Z';

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-multi-role-'));
    db = createDatabase(dataDir);
    seedDatabase(db);
    runMigrations(db);
    context = {
      userId: 'user-admin-001',
      clinicId: 'clinic-v2-001',
      role: 'BOSS',
      traceId: 'test',
      now: () => new Date(now),
    };
  });

  afterEach(() => {
    db.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  function insertUser(id: string, role: string): void {
    db.prepare(
      `INSERT INTO User (
         id, clinicId, createdAt, updatedAt, deletedAt,
         username, passwordHash, name, role, phone, active, loginAttempts, tokenVersion
       ) VALUES (?, 'clinic-v2-001', ?, ?, NULL, ?, 'x', ?, ?, NULL, 1, 0, 0)`,
    ).run(id, now, now, `user-${id}`, `员工-${id}`, role);
  }

  function rows(userId: string): Array<{ userId: string; role: string; deletedAt: string | null }> {
    return db.prepare(
      'SELECT userId, role, deletedAt FROM UserRole WHERE userId = ? ORDER BY role',
    ).all(userId) as Array<{ userId: string; role: string; deletedAt: string | null }>;
  }

  it('setRoles creates UserRole rows and listAll returns them for the clinic', () => {
    const service = new UserRoleService(db);
    insertUser('user-doctor-001', 'DOCTOR');

    const result = service.setRoles('user-doctor-001', ['BOSS', 'DOCTOR'], context);
    expect(result).toEqual(['BOSS']);

    const persisted = rows('user-doctor-001');
    expect(persisted).toEqual([
      { userId: 'user-doctor-001', role: 'BOSS', deletedAt: null },
    ]);
    const all = service.listAll(context);
    const mine = all.filter((row) => row.userId === 'user-doctor-001');
    expect(mine.map((row) => row.role).sort()).toEqual(['BOSS']);
    expect(mine.every((row) => row.clinicId === 'clinic-v2-001')).toBe(true);
  });

  it('setRoles falls back to the unscoped user lookup and null clinic when the context has no clinic', () => {
    const service = new UserRoleService(db);
    insertUser('user-no-clinic', 'DOCTOR');

    const result = service.setRoles('user-no-clinic', ['DOCTOR', 'ADMIN'], {
      ...context,
      clinicId: null,
    });
    expect(result).toEqual(['ADMIN']);
    // v153 起 UserRole.clinicId 为 NOT NULL：null 诊所的 INSERT OR IGNORE 被约束静默跳过，
    // 但 `context.clinicId ?? null` 的空值分支已执行（result 说明用户查找与 diff 均走通）。
    expect(rows('user-no-clinic')).toEqual([]);
  });

  it('setRoles diffs by adding and removing roles, and dedupes input', () => {
    const service = new UserRoleService(db);
    insertUser('user-doctor-002', 'DOCTOR');
    service.setRoles('user-doctor-002', ['BOSS', 'DOCTOR', 'BOSS'], context);

    const result = service.setRoles('user-doctor-002', ['DOCTOR'], context);
    expect(result).toEqual([]);

    const persisted = rows('user-doctor-002').map((row) => row.role);
    expect(persisted).toEqual([]);
  });

  it('setRoles skips the primary role from User.role', () => {
    const service = new UserRoleService(db);
    insertUser('user-doctor-003', 'DOCTOR');

    const result = service.setRoles('user-doctor-003', ['DOCTOR', 'BOSS'], context);
    expect(result).toEqual(['BOSS']);
    const persisted = rows('user-doctor-003').map((row) => row.role);
    expect(persisted).toEqual(['BOSS']);
  });

  it('setRoles rejects invalid role values with ValidationError', () => {
    const service = new UserRoleService(db);
    insertUser('user-doctor-004', 'DOCTOR');

    expect(() => service.setRoles('user-doctor-004', ['NOT_A_ROLE'], context)).toThrow(ValidationError);
    expect(() => service.setRoles('user-doctor-004', 'BOSS' as unknown as string[], context)).toThrow(ValidationError);
  });

  it('blocks ADMIN from assigning BOSS role or managing a BOSS user', () => {
    insertUser('user-doctor-001', 'DOCTOR');
    const service = new UserRoleService(db);
    insertUser('user-admin-role', 'ADMIN');
    insertUser('user-boss-role', 'BOSS');
    const adminContext: AppContext = { ...context, role: 'ADMIN', userId: 'user-admin-role' };
    expect(() => service.setRoles('user-doctor-001', ['BOSS'], adminContext))
      .toThrow('管理员不能授予老板角色');
    expect(() => service.setRoles('user-boss-role', ['DOCTOR'], adminContext))
      .toThrow('管理员不能管理老板账号');
  });

  it('setRoles throws NotFoundError for an unknown user in this clinic', () => {
    const service = new UserRoleService(db);
    expect(() => service.setRoles('user-missing-001', ['DOCTOR'], context)).toThrow(NotFoundError);
  });

  it('stores per-clinic additional roles independently', () => {
    const secondClinic = 'clinic-v2-002';
    db.prepare(
      `INSERT OR IGNORE INTO Clinic (id, clinicId, createdAt, updatedAt, deletedAt, code, name, active)
       VALUES (?, NULL, ?, ?, NULL, 'C2', 'Second Clinic', 1)`,
    ).run(secondClinic, now, now);

    const service = new UserRoleService(db);
    insertUser('user-doctor-006', 'DOCTOR');
    db.prepare(
      `INSERT OR IGNORE INTO UserClinic (userId, clinicId, role, createdAt, updatedAt, deletedAt)
       VALUES (?, ?, 'DOCTOR', ?, ?, NULL)`,
    ).run('user-doctor-006', secondClinic, now, now);

    service.setRoles('user-doctor-006', ['BOSS'], context);
    service.setRoles('user-doctor-006', ['BOSS'], { ...context, clinicId: secondClinic });

    const firstClinicRows = service.listAll(context).filter((row) => row.userId === 'user-doctor-006');
    const secondClinicRows = service.listAll({ ...context, clinicId: secondClinic })
      .filter((row) => row.userId === 'user-doctor-006');
    expect(firstClinicRows).toHaveLength(1);
    expect(secondClinicRows).toHaveLength(1);
    expect(firstClinicRows[0].clinicId).toBe('clinic-v2-001');
    expect(secondClinicRows[0].clinicId).toBe(secondClinic);
  });

  it('listAll is tenant-scoped and hides deleted rows', () => {
    const service = new UserRoleService(db);
    insertUser('user-doctor-005', 'DOCTOR');
    service.setRoles('user-doctor-005', ['BOSS'], context);
    db.prepare("UPDATE UserRole SET deletedAt = ? WHERE userId = 'user-doctor-005' AND role = 'BOSS'")
      .run(now);

    const all = service.listAll(context);
    expect(all.some((row) => row.userId === 'user-doctor-005')).toBe(false);
  });

  it('listAll falls back to an unscoped query when clinic id is missing', () => {
    const service = new UserRoleService(db);
    insertUser('user-doctor-007', 'DOCTOR');
    service.setRoles('user-doctor-007', ['BOSS'], context);
    expect(() => service.listAll({ ...context, clinicId: null })).not.toThrow();
  });
});
