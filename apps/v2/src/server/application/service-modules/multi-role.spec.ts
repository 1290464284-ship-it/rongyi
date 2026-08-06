import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

  beforeAll(() => {
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

  afterAll(() => {
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

  it('setRoles throws NotFoundError for an unknown user in this clinic', () => {
    const service = new UserRoleService(db);
    expect(() => service.setRoles('user-missing-001', ['DOCTOR'], context)).toThrow(NotFoundError);
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
});
